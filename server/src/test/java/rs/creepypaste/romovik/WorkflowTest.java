package rs.creepypaste.romovik;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.bson.Document;
import rs.adsdev.helpers.javalin.app.PasswordHasherHelper;
import java.nio.file.Path;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.io.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="TEST_MONGO_BASE", matches=".+")
class WorkflowTest {
    @TempDir Path assets;
    final HttpClient client = HttpClient.newHttpClient();
    String base, cookie = "", csrf = "";
    HttpResponse<byte[]> request(String method, String path, String body, boolean auth) throws Exception {
        var r = HttpRequest.newBuilder(URI.create(base + path)).header("Origin", "http://tests.local").header("Content-Type", "application/json");
        if (auth) r.header("Cookie", cookie).header("X-CSRF-Token", csrf);
        return client.send(r.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofByteArray());
    }
    Document json(HttpResponse<byte[]> r) { return Document.parse(new String(r.body(), StandardCharsets.UTF_8)); }
    void login(String password) throws Exception {
        var r = request("POST", "/api/auth/login", new Document("login","admin").append("password",password).toJson(), false); assertEquals(200,r.statusCode());
        cookie = r.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0]; csrf = json(r).getString("csrf");
    }
    String submit() throws Exception {
        String boundary = "romovik-test-boundary"; var out = new ByteArrayOutputStream();
        Map<String,String> fields = Map.of("chip","Test EPROM","manufacturer","Test maker","type","EPROM","label","TEST 01","origin","unknown","website","","consent","yes","contact","private@example.test");
        for (var e : fields.entrySet()) out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+e.getKey()+"\"\r\n\r\n"+e.getValue()+"\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"dump\"; filename=\"example-2.BIN\"\r\nContent-Type: application/octet-stream\r\n\r\n!VERSION 1.0!\r\n").getBytes(StandardCharsets.UTF_8));
        var img = new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB); var image = new ByteArrayOutputStream(); javax.imageio.ImageIO.write(img,"png",image);
        out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"photos\"; filename=\"chip.png\"\r\nContent-Type: image/png\r\n\r\n").getBytes()); out.write(image.toByteArray()); out.write(("\r\n--"+boundary+"--\r\n").getBytes());
        var request = HttpRequest.newBuilder(URI.create(base+"/api/submissions")).header("Origin","http://tests.local").header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray())).build();
        var response = client.send(request,HttpResponse.BodyHandlers.ofByteArray()); assertEquals(201,response.statusCode(),new String(response.body())); return json(response).getString("id");
    }
    @Test void privateSubmissionAuthAtomicApprovalRejectionAndSequence() throws Exception {
        String db = "romovik_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var store = new Store(System.getenv("TEST_MONGO_BASE") + db + "?directConnection=true", assets)) {
            var app = Main.application(store,"http://tests.local").start("127.0.0.1",0); base="http://127.0.0.1:"+app.port();
            try {
                String password="Workflow-password-original";
                store.users.insertOne(new Document("_id","admin").append("hash",PasswordHasherHelper.hashForStorage(password)).append("version","v1").append("mustChangePassword",false));
                String id=submit(); assertEquals(404,request("GET","/dumps/"+id+"/dump.bin",null,false).statusCode());
                assertEquals(401,request("GET","/api/moderation/submissions/"+id,null,false).statusCode());
                login(password);
                var detail=json(request("GET","/api/moderation/submissions/"+id,null,true)); assertEquals("private@example.test",detail.getString("contact"));
                assertEquals(200,request("GET","/api/moderation/submissions/"+id+"/files/dump.bin",null,true).statusCode());
                detail.put("markingsConfirmed",true);detail.put("stringsReviewed",true);detail.put("strings",List.of(new Document("offset",1).append("text","VERSION 1.0")));
                String valid=detail.toJson(), saved=csrf; csrf="wrong";assertEquals(403,request("POST","/api/moderation/submissions/"+id+"/approve",valid,true).statusCode());csrf=saved;
                detail.put("strings",List.of(new Document("offset",2).append("text","VERSION 1.0")));assertEquals(400,request("POST","/api/moderation/submissions/"+id+"/approve",detail.toJson(),true).statusCode());
                var executor=java.util.concurrent.Executors.newFixedThreadPool(2);
                try {
                    var a=executor.submit(()->request("POST","/api/moderation/submissions/"+id+"/approve",valid,true).statusCode());
                    var b=executor.submit(()->request("POST","/api/moderation/submissions/"+id+"/approve",valid,true).statusCode());
                    assertEquals(Set.of(200,409),Set.of(a.get(),b.get()));
                } finally { executor.shutdownNow(); }
                assertEquals(1,store.records.countDocuments()); assertEquals(1,((Number)store.record(id).get("sequence")).intValue());
                assertArrayEquals("!VERSION 1.0!".getBytes(),request("GET","/dumps/"+id+"/dump.bin",null,false).body());
                String publicJson=new String(request("GET","/api/catalog",null,false).body()); assertFalse(publicJson.contains("private@example.test"));assertFalse(publicJson.contains("contact"));
                String reject=submit();assertEquals(204,request("POST","/api/moderation/submissions/"+reject+"/reject","{\"reason\":\"test rejection\"}",true).statusCode());
                assertEquals(404,request("GET","/dumps/"+reject+"/dump.bin",null,false).statusCode());
                assertEquals(409,request("POST","/api/moderation/submissions/"+reject+"/approve",valid,true).statusCode());
                assertEquals(200,request("POST","/api/auth/password",new Document("currentPassword",password).append("newPassword","Workflow-password-changed").toJson(),true).statusCode());
                assertEquals(401,request("GET","/api/auth/session",null,true).statusCode());
                // A login that verified the old credential before rotation cannot revive its old session version.
                String stale=Main.token();store.sessions.insertOne(new Document("_id",Main.digest(stale)).append("user","admin").append("version","v1").append("csrf","x").append("expiresAt",new Date(System.currentTimeMillis()+60000)));
                cookie=Main.COOKIE+"="+stale;assertEquals(401,request("GET","/api/auth/session",null,true).statusCode());
                login("Workflow-password-changed");assertEquals(200,request("GET","/api/auth/session",null,true).statusCode());
            } finally { app.stop(); store.mongo.getDatabase().drop(); }
        }
    }
}
