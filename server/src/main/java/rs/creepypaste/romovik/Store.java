package rs.creepypaste.romovik;

import com.mongodb.ReadConcern;
import com.mongodb.WriteConcern;
import com.mongodb.TransactionOptions;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.*;
import org.bson.Document;
import rs.adsdev.helpers.mongodb.MongoDatabaseManager;
import io.javalin.http.*;
import java.nio.file.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.TimeUnit;
import static com.mongodb.client.model.Filters.*;
import static com.mongodb.client.model.Updates.*;

final class Store implements AutoCloseable {
    final MongoDatabaseManager mongo;
    final MongoCollection<Document> records, submissions, sessions, users, counters, audit, limits;
    final Path assets;
    Store(String uri, Path assets) throws Exception {
        mongo = new MongoDatabaseManager(uri);
        var db = mongo.getDatabase().withWriteConcern(WriteConcern.MAJORITY);
        records = db.getCollection("records"); submissions = db.getCollection("submissions");
        sessions = db.getCollection("sessions"); users = db.getCollection("moderators");
        counters = db.getCollection("counters"); audit = db.getCollection("moderation_log"); limits = db.getCollection("rate_limits");
        this.assets = assets.toAbsolutePath().normalize(); Files.createDirectories(this.assets);
        records.createIndex(Indexes.ascending("id"), new IndexOptions().unique(true));
        records.createIndex(Indexes.ascending("sequence"), new IndexOptions().unique(true));
        submissions.createIndex(Indexes.ascending("status", "createdAt"));
        sessions.createIndex(Indexes.ascending("expiresAt"), new IndexOptions().expireAfter(0L, TimeUnit.SECONDS));
        limits.createIndex(Indexes.ascending("expiresAt"), new IndexOptions().expireAfter(0L, TimeUnit.SECONDS));
        counters.updateOne(eq("_id", "sequence"), setOnInsert("value", 0), new UpdateOptions().upsert(true));
    }
    Document record(String id) { return records.find(eq("id", Validation.id(id))).projection(Projections.excludeId()).first(); }
    List<Document> catalog() { return records.find().projection(Projections.excludeId()).sort(Sorts.ascending("sequence")).into(new ArrayList<>()); }
    Path asset(String id, String file) {
        Validation.id(id);
        if (!file.matches("[a-zA-Z0-9][a-zA-Z0-9._-]*") || file.contains("..")) throw new NotFoundResponse();
        return assets.resolve(id).resolve(file);
    }
    void checkAssets(Document record) throws Exception {
        String id = record.getString("id");
        var dump = record.get("dump", Document.class);
        List<Document> files = new ArrayList<>(record.getList("photos", Document.class)); files.add(dump);
        for (Document f : files) {
            byte[] bytes = Files.readAllBytes(asset(id, f.getString("file")));
            if (bytes.length != ((Number) f.get("size")).longValue() || !Validation.hash(bytes).equals(f.getString("sha256"))) throw new IllegalStateException("Asset verification failed: " + id);
        }
        Validation.strings(record, Files.readAllBytes(asset(id, dump.getString("file"))));
    }
    void seed(Path catalog) throws Exception {
        // Idempotent insert-only import. A later release never overwrites live moderation.
        try (var files = Files.list(catalog)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".json")).sorted().toList()) {
                Document record = Document.parse(Files.readString(file));
                Validation.id(record.getString("id")); checkAssets(record);
                String id = record.getString("id");
                if (records.find(eq("id", id)).first() == null) records.insertOne(record);
                else if (!Objects.equals(record("" + id).get("dump"), record.get("dump"))) throw new IllegalStateException("Existing dump differs: " + id);
                counters.updateOne(eq("_id", "sequence"), max("value", ((Number) record.get("sequence")).longValue()));
            }
        }
    }
    Document submission(String id) {
        Document value = submissions.find(eq("_id", Validation.id(id))).first();
        if (value == null) throw new NotFoundResponse();
        return value;
    }
    Document append(Document input) throws Exception {
        Validation.id(input.getString("id")); checkAssets(input);
        Validation.metadata(input);
        try (var session = mongo.getClient().startSession()) {
            return session.withTransaction(() -> {
                Document existing = records.find(session, eq("id", input.getString("id"))).first();
                if (existing != null) {
                    if (!Objects.equals(existing.get("dump"), input.get("dump"))) throw new IllegalStateException("Existing dump differs");
                    existing.remove("_id"); return existing;
                }
                Document counter = counters.findOneAndUpdate(session, eq("_id", "sequence"), inc("value", 1), new FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER));
                Document value = new Document(input); value.remove("_id"); value.put("sequence", counter.get("value"));
                records.insertOne(session, value);
                audit.insertOne(session, new Document("submission", input.getString("id")).append("action", "owner-import").append("at", new Date()));
                value.remove("_id"); return value;
            });
        }
    }
    String approve(String id, Document input, String moderator) throws Exception {
        Document submitted = submission(id), fields = Validation.metadata(input);
        byte[] bytes = Files.readAllBytes(asset(id, submitted.get("dump", Document.class).getString("file")));
        var strings = Validation.strings(input, bytes);
        if (!Boolean.TRUE.equals(input.get("markingsConfirmed")) || !Boolean.TRUE.equals(input.get("stringsReviewed"))) throw new BadRequestResponse("Подтвердите маркировку и просмотр строк.");
        try (var session = mongo.getClient().startSession()) {
            return session.withTransaction(() -> {
                Document current = submissions.find(session, eq("_id", id)).first();
                if (current == null || !"pending".equals(current.getString("status"))) throw new ConflictResponse("Заявка уже рассмотрена.");
                Document count = counters.findOneAndUpdate(session, eq("_id", "sequence"), inc("value", 1), new FindOneAndUpdateOptions().returnDocument(ReturnDocument.AFTER));
                var record = new Document(fields).append("id", id).append("sequence", count.get("value"))
                    .append("dateAdded", LocalDate.now(ZoneOffset.UTC).toString()).append("readDate", null)
                    .append("readVerification", "not-recorded").append("readCount", null).append("deviceTest", "not-tested")
                    .append("tags", List.of()).append("dump", current.get("dump")).append("photos", current.get("photos"))
                    .append("strings", strings).append("stringsReviewed", true);
                records.insertOne(session, record);
                submissions.updateOne(session, eq("_id", id), combine(set("status", "approved"), set("reviewedAt", new Date()), set("moderator", moderator)));
                audit.insertOne(session, new Document("submission", id).append("action", "approved").append("moderator", moderator).append("at", new Date()));
                return id;
            }, TransactionOptions.builder().readConcern(ReadConcern.SNAPSHOT).writeConcern(WriteConcern.MAJORITY).build());
        }
    }
    void reject(String id, String reason, String moderator) {
        try (var session = mongo.getClient().startSession()) {
            session.withTransaction(() -> {
                var changed = submissions.updateOne(session, and(eq("_id", Validation.id(id)), eq("status", "pending")), combine(set("status", "rejected"), set("reason", reason), set("reviewedAt", new Date()), set("moderator", moderator)));
                if (changed.getModifiedCount() != 1) throw new ConflictResponse("Заявка уже рассмотрена.");
                audit.insertOne(session, new Document("submission", id).append("action", "rejected").append("reason", reason).append("moderator", moderator).append("at", new Date()));
                return true;
            });
        }
    }
    void rate(String kind, String identity, int max, long seconds) {
        long bucket = Instant.now().getEpochSecond() / seconds;
        String key = kind + ":" + Validation.hash(identity.getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ":" + bucket;
        Document value = limits.findOneAndUpdate(eq("_id", key), combine(inc("count", 1), setOnInsert("expiresAt", Date.from(Instant.ofEpochSecond((bucket + 2) * seconds)))), new FindOneAndUpdateOptions().upsert(true).returnDocument(ReturnDocument.AFTER));
        if (((Number)value.get("count")).intValue() > max) throw new HttpResponseException(429, "Слишком много попыток. Попробуйте позже.");
    }
    public void close() { mongo.close(); }
}
