package rs.creepypaste.romovik;

import io.javalin.Javalin;
import io.javalin.http.*;
import org.bson.Document;
import rs.adsdev.helpers.javalin.app.PasswordHasherHelper;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;
import static com.mongodb.client.model.Filters.*;
import static com.mongodb.client.model.Updates.*;
import com.mongodb.client.model.Projections;
import com.mongodb.client.model.Sorts;

public final class Main {
    static final String COOKIE = "romovik_session";
    static final SecureRandom RANDOM = new SecureRandom();
    static String token() { byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes); return HexFormat.of().formatHex(bytes); }
    static String env(String name, String fallback) { return System.getenv().getOrDefault(name, fallback); }
    static String secret(String name) throws IOException {
        String filename = System.getenv(name + "_FILE");
        String result = filename == null ? System.getenv(name) : Files.readString(Path.of(filename)).strip();
        if (result == null || result.isBlank()) throw new IllegalStateException(name + " is required");
        return result;
    }
    public static void main(String[] args) throws Exception {
        System.setProperty("org.slf4j.simpleLogger.log.org.mongodb.driver", "warn");
        Store store = new Store(secret("MONGO_URI"), Path.of(env("ASSET_DIR", "data/assets")));
        if (args.length > 0 && args[0].equals("seed")) {
            try (store) { store.seed(Path.of(args[1])); System.out.println("Catalog imported: " + store.records.countDocuments()); } return;
        }
        if (args.length > 0 && args[0].equals("import")) {
            try (store) { System.out.println(store.append(Document.parse(Files.readString(Path.of(args[1])))).toJson()); } return;
        }
        if (args.length > 0 && args[0].equals("create-admin")) {
            try (store) {
                if (store.users.countDocuments() != 0) throw new IllegalStateException("Moderator already exists");
                String password = new String(System.in.readNBytes(1024), StandardCharsets.UTF_8).strip();
                if (password.length() < 16 || password.length() > 256) throw new IllegalArgumentException("Password must have 16–256 characters");
                store.users.insertOne(new Document("_id", "admin").append("hash", PasswordHasherHelper.hashForStorage(password)).append("version", token()).append("mustChangePassword", true));
                System.out.println("Moderator created; password change required on first login.");
            } return;
        }
        String origin = env("SITE_ORIGIN", "http://localhost:4321");
        Javalin app = application(store, origin).start(env("BIND_HOST", "127.0.0.1"), Integer.parseInt(env("PORT", "8080")));
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { app.stop(); store.close(); }));
    }
    static Javalin application(Store store, String origin) {
        boolean secure = origin.startsWith("https://");
        Javalin app = Javalin.create(config -> {
            config.showJavalinBanner = false;
            config.http.maxRequestSize = 42L * 1024 * 1024;
            config.jetty.multipartConfig.maxFileSize(16 * 1024 * 1024, io.javalin.config.SizeUnit.BYTES);
            config.jetty.multipartConfig.maxTotalRequestSize(42 * 1024 * 1024, io.javalin.config.SizeUnit.BYTES);
            config.jetty.modifyServer(server -> server.setStopTimeout(30_000L));
        });
        var uploads = new java.util.concurrent.Semaphore(2);
        app.before(ctx -> {
            ctx.header("X-Content-Type-Options", "nosniff");
            ctx.header("Cache-Control", "no-store");
            ctx.header("X-Frame-Options", "DENY");
            if (!Set.of("GET", "HEAD", "OPTIONS").contains(ctx.method().name()) && !origin.equals(ctx.header("Origin"))) throw new ForbiddenResponse("Недопустимый источник запроса.");
            if (ctx.path().startsWith("/api/moderation")) {
                Document session = session(store, ctx);
                Document user = store.users.find(eq("_id", session.getString("user"))).first();
                if (user == null || Boolean.TRUE.equals(user.get("mustChangePassword"))) throw new ForbiddenResponse("Сначала смените временный пароль.");
                if (!ctx.method().name().equals("GET")) csrf(ctx, session);
                ctx.attribute("moderator", session.getString("user"));
            }
        });
        app.before("/api/submissions", ctx -> {
            if (ctx.method().name().equals("POST")) {
                if (!uploads.tryAcquire()) throw new HttpResponseException(429, "Сейчас загружаются другие файлы. Повторите через минуту.");
                ctx.attribute("uploadPermit", true);
            }
        });
        app.after(ctx -> { if (Boolean.TRUE.equals(ctx.attribute("uploadPermit"))) uploads.release(); });
        app.exception(HttpResponseException.class, (e,ctx) -> ctx.status(e.getStatus()).json(Map.of("error", e.getMessage())));
        app.exception(Exception.class, (e,ctx) -> {
            if (e instanceof IllegalStateException && Objects.toString(e.getMessage(), "").toLowerCase(Locale.ROOT).contains("exceed")) {
                ctx.status(413).json(Map.of("error", "Превышен размер вложения: дамп до 16 МиБ, фото до 8 МиБ, всего до 42 МиБ.")); return;
            }
            // Driver exceptions can include connection details. Do not print their messages.
            System.err.println("Request failed: " + e.getClass().getSimpleName());
            ctx.status(503).json(Map.of("error", "Сервис временно недоступен. Попробуйте позже."));
        });
        app.get("/health", ctx -> { store.mongo.getDatabase().runCommand(new Document("ping", 1)); ctx.json(Map.of("ok", true)); });
        app.get("/api/catalog", ctx -> ctx.json(store.catalog()));
        app.get("/api/catalog/{id}", ctx -> { var record = store.record(ctx.pathParam("id")); if (record == null) throw new NotFoundResponse(); ctx.json(record); });
        app.get("/dumps/catalog.json", ctx -> ctx.json(store.catalog()));
        app.get("/dumps/{id}/{file}", ctx -> {
            Document record = store.record(ctx.pathParam("id"));
            if (record == null) throw new NotFoundResponse();
            serveAsset(store, ctx, record, false);
        });
        app.post("/api/submissions", ctx -> {
            String ip = clientIp(ctx);
            store.rate("submit-ip", ip, 3, 3600); store.rate("submit-global", "all", 30, 3600);
            if (store.submissions.countDocuments(eq("status", "pending")) >= 200 || Files.getFileStore(store.assets).getUsableSpace() < 1024L * 1024 * 1024) throw new HttpResponseException(503, "Приём временно приостановлен. Попробуйте позже.");
            if (!ctx.isMultipartFormData()) throw new BadRequestResponse("Прикрепите файл дампа и фотографию.");
            if (!Objects.equals(ctx.formParam("website"), "")) throw new BadRequestResponse("Не удалось отправить заявку.");
            if (!Objects.equals(ctx.formParam("consent"), "yes")) throw new BadRequestResponse("Подтвердите отправку для публичного архива.");
            Document raw = new Document();
            for (String field : List.of("chip", "manufacturer", "type", "package", "label", "description", "device", "board", "origin", "programmer", "profile", "notes", "contact")) raw.put(field, Objects.toString(ctx.formParam(field), ""));
            // Unknown manufacturer/marking can be completed during moderation, never published automatically.
            if (raw.getString("manufacturer").isBlank()) raw.put("manufacturer", "Не указан");
            if (raw.getString("label").isBlank()) raw.put("label", raw.getString("chip"));
            Document fields = Validation.metadata(raw);
            String contact = Validation.text(raw, "contact", 300, false);
            List<UploadedFile> dumps = ctx.uploadedFiles("dump"), photos = ctx.uploadedFiles("photos");
            if (dumps.size() != 1 || photos.isEmpty() || photos.size() > 3 || ctx.uploadedFiles().size() != 1 + photos.size()) throw new BadRequestResponse("Нужны один BIN-файл и 1–3 фотографии.");
            String originalName = Validation.filename(dumps.getFirst().filename());
            if (!originalName.toLowerCase(Locale.ROOT).endsWith(".bin")) throw new BadRequestResponse("Дамп должен быть файлом .BIN.");
            byte[] dump = Validation.bytes(dumps.getFirst().content(), Validation.DUMP_LIMIT);
            List<byte[]> imageBytes = new ArrayList<>(); List<String> imageNames = new ArrayList<>();
            for (UploadedFile photo : photos) {
                byte[] data = Validation.bytes(photo.content(), Validation.PHOTO_LIMIT);
                imageNames.add("photo-" + (imageBytes.size() + 1) + "." + Validation.imageExtension(data)); imageBytes.add(data);
            }
            String id = "s-" + UUID.randomUUID();
            Path dir = store.assets.resolve(id); Files.createDirectory(dir);
            // Original bytes stay private on disk. Only records collection grants public access.
            Files.write(dir.resolve("dump.bin"), dump, StandardOpenOption.CREATE_NEW);
            List<Document> photoInfo = new ArrayList<>();
            for (int i = 0; i < imageBytes.size(); i++) {
                Files.write(dir.resolve(imageNames.get(i)), imageBytes.get(i), StandardOpenOption.CREATE_NEW);
                photoInfo.add(assetInfo(imageNames.get(i), imageBytes.get(i)).append("alt", fields.getString("chip") + " — фотография " + (i + 1)));
            }
            Document submission = new Document(fields).append("_id", id).append("id", id).append("status", "pending").append("createdAt", new Date()).append("contact", contact)
                .append("dump", assetInfo("dump.bin", dump).append("originalFilename", originalName)).append("photos", photoInfo);
            store.submissions.insertOne(submission);
            ctx.status(201).json(Map.of("id", id, "message", "Дамп получен и отправлен на модерацию. После проверки он появится в каталоге."));
        });
        app.post("/api/auth/login", ctx -> {
            store.rate("login-ip", clientIp(ctx), 15, 600);
            Document body = body(ctx);
            String login = Validation.text(body, "login", 100, true), password = Validation.text(body, "password", 256, true);
            store.rate("login-account", login, 10, 600);
            Document user = store.users.find(eq("_id", login)).first();
            boolean valid = false;
            if (user == null) PasswordHasherHelper.verifyAgainstDummy(password); else valid = PasswordHasherHelper.verifyPassword(password, user.getString("hash"));
            if (!valid) throw new UnauthorizedResponse("Неверный логин или пароль.");
            String sid = token(), csrf = token();
            store.sessions.insertOne(new Document("_id", digest(sid)).append("user", login).append("version", user.get("version")).append("csrf", csrf).append("expiresAt", Date.from(Instant.now().plusSeconds(8 * 3600))));
            ctx.header("Set-Cookie", COOKIE + "=" + sid + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800" + (secure ? "; Secure" : ""));
            ctx.json(Map.of("login", login, "csrf", csrf, "mustChangePassword", Boolean.TRUE.equals(user.get("mustChangePassword"))));
        });
        app.get("/api/auth/session", ctx -> {
            var session = session(store, ctx); var user = store.users.find(eq("_id", session.getString("user"))).first();
            if (user == null) throw new UnauthorizedResponse();
            ctx.json(Map.of("login", session.getString("user"), "csrf", session.getString("csrf"), "mustChangePassword", Boolean.TRUE.equals(user.get("mustChangePassword"))));
        });
        app.post("/api/auth/logout", ctx -> { var session = session(store, ctx); csrf(ctx, session); store.sessions.deleteOne(eq("_id", session.getString("_id"))); clearCookie(ctx, secure); ctx.status(204); });
        app.post("/api/auth/password", ctx -> {
            var session = session(store, ctx); csrf(ctx, session);
            store.rate("password", session.getString("user"), 5, 600);
            Document body = body(ctx); String previous = Validation.text(body, "currentPassword", 256, true), next = Validation.text(body, "newPassword", 256, true);
            if (next.length() < 12 || next.equals(previous)) throw new BadRequestResponse("Новый пароль должен отличаться от прежнего и содержать не менее 12 символов.");
            Document user = store.users.find(eq("_id", session.getString("user"))).first();
            if (user == null || !PasswordHasherHelper.verifyPassword(previous, user.getString("hash"))) throw new UnauthorizedResponse("Неверный текущий пароль.");
            var changed = store.users.updateOne(and(eq("_id", session.getString("user")), eq("hash", user.getString("hash"))), combine(set("hash", PasswordHasherHelper.hashForStorage(next)), set("version", token()), set("mustChangePassword", false)));
            if (changed.getModifiedCount() != 1) throw new ConflictResponse("Пароль уже изменён. Войдите заново.");
            store.sessions.deleteMany(eq("user", session.getString("user"))); clearCookie(ctx, secure); ctx.json(Map.of("message", "Пароль изменён. Войдите заново."));
        });
        app.get("/api/moderation/submissions", ctx -> {
            String status = Objects.toString(ctx.queryParam("status"), "pending");
            if (!Set.of("pending", "approved", "rejected").contains(status)) throw new BadRequestResponse();
            int page = ctx.queryParamAsClass("page", Integer.class).getOrDefault(0);
            if (page < 0 || page > 10000) throw new BadRequestResponse();
            ctx.json(Map.of("items", store.submissions.find(eq("status", status)).projection(Projections.exclude("_id")).sort(Sorts.ascending("createdAt", "id")).skip(page * 30).limit(30).into(new ArrayList<>()), "total", store.submissions.countDocuments(eq("status", status))));
        });
        app.get("/api/moderation/submissions/{id}", ctx -> {
            var submission = store.submission(ctx.pathParam("id")); submission.remove("_id");
            var dump = submission.get("dump", Document.class);
            submission.put("candidates", Validation.candidates(Files.readAllBytes(store.asset(submission.getString("id"), dump.getString("file")))));
            submission.put("duplicates", store.records.find(eq("dump.sha256", dump.getString("sha256"))).projection(Projections.include("id", "chip", "sequence")).into(new ArrayList<>()).stream().peek(d -> d.remove("_id")).toList());
            ctx.json(submission);
        });
        app.get("/api/moderation/submissions/{id}/files/{file}", ctx -> serveAsset(store, ctx, store.submission(ctx.pathParam("id")), true));
        app.post("/api/moderation/submissions/{id}/approve", ctx -> ctx.json(Map.of("id", store.approve(ctx.pathParam("id"), body(ctx), ctx.attribute("moderator")))));
        app.post("/api/moderation/submissions/{id}/reject", ctx -> { store.reject(ctx.pathParam("id"), Validation.text(body(ctx), "reason", 2000, true), ctx.attribute("moderator")); ctx.status(204); });
        return app;
    }
    static String clientIp(Context ctx) { return Objects.toString(ctx.header("X-Client-IP"), ctx.ip()); }
    static String digest(String value) { return Validation.hash(value.getBytes(StandardCharsets.UTF_8)); }
    static Document body(Context ctx) {
        if (ctx.contentLength() > 100_000) throw new BadRequestResponse("Слишком большой запрос.");
        try { return Document.parse(new String(Validation.bytes(ctx.req().getInputStream(), 100_000), StandardCharsets.UTF_8)); }
        catch (BadRequestResponse e) { throw e; }
        catch (RuntimeException | IOException e) { throw new BadRequestResponse("Некорректный JSON."); }
    }
    static Document session(Store store, Context ctx) {
        String value = ctx.cookie(COOKIE);
        if (value == null || !value.matches("[a-f0-9]{64}")) throw new UnauthorizedResponse("Войдите в учётную запись модератора.");
        Document session = store.sessions.find(and(eq("_id", digest(value)), gt("expiresAt", new Date()))).first();
        if (session == null) throw new UnauthorizedResponse("Сеанс закончился. Войдите заново.");
        Document user = store.users.find(eq("_id", session.getString("user"))).first();
        if (user == null || !Objects.equals(user.get("version"), session.get("version"))) throw new UnauthorizedResponse("Сеанс отозван. Войдите заново.");
        return session;
    }
    static void csrf(Context ctx, Document session) {
        if (!session.getString("csrf").equals(ctx.header("X-CSRF-Token"))) throw new ForbiddenResponse("Обновите страницу и повторите действие.");
    }
    static void clearCookie(Context ctx, boolean secure) { ctx.header("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (secure ? "; Secure" : "")); }
    static Document assetInfo(String file, byte[] data) { return new Document("file", file).append("size", data.length).append("sha256", Validation.hash(data)); }
    static void serveAsset(Store store, Context ctx, Document record, boolean privateAsset) throws Exception {
        String file = ctx.pathParam("file"), id = record.getString("id");
        var dump = record.get("dump", Document.class);
        Document info = file.equals(dump.getString("file")) ? dump : record.getList("photos", Document.class).stream().filter(p -> file.equals(p.getString("file"))).findFirst().orElseThrow(NotFoundResponse::new);
        Path path = store.asset(id, file);
        if (!Files.isRegularFile(path)) throw new NotFoundResponse();
        String type = file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : file.endsWith(".webp") ? "image/webp" : "application/octet-stream";
        ctx.contentType(type).header("ETag", "\"" + info.getString("sha256") + "\"");
        ctx.header("Cache-Control", privateAsset ? "private, no-store" : "public, max-age=3600");
        if (info == dump) ctx.header("Content-Disposition", "attachment; filename=\"" + id + ".bin\"");
        ctx.result(Files.newInputStream(path));
    }
}
