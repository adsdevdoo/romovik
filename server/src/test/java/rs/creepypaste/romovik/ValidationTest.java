package rs.creepypaste.romovik;
import org.junit.jupiter.api.Test;
import org.bson.Document;
import io.javalin.http.BadRequestResponse;
import rs.adsdev.helpers.javalin.app.PasswordHasherHelper;
import java.util.*;
import java.io.*;
import static org.junit.jupiter.api.Assertions.*;
class ValidationTest {
    @Test void pathsCannotEscapeAssetRoot() {
        for (String path : List.of("../file", "a/b", "a\\b", "C:dump.bin", "x\n.bin")) assertThrows(BadRequestResponse.class, () -> Validation.filename(path));
        assertEquals("M27C4001@DIP32-2.BIN", Validation.filename("M27C4001@DIP32-2.BIN"));
        assertThrows(BadRequestResponse.class, () -> Validation.id("../pending"));
    }
    @Test void selectedTextMustMatchExactOffset() {
        byte[] bytes = "!VERSION 1.0!".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        var d = new Document("strings", List.of(new Document("offset", 1).append("text", "VERSION 1.0")));
        assertEquals(1, Validation.strings(d, bytes).size());
        for (Object offset : List.of(-1, 2, 1.5, Long.MAX_VALUE)) {
            var bad = new Document("strings", List.of(new Document("offset", offset).append("text", "VERSION 1.0")));
            assertThrows(BadRequestResponse.class, () -> Validation.strings(bad, bytes));
        }
    }
    @Test void uploadBoundsAndImageTypesAreEnforced() throws Exception {
        assertThrows(BadRequestResponse.class, () -> Validation.bytes(new ByteArrayInputStream(new byte[0]), 5));
        assertThrows(BadRequestResponse.class, () -> Validation.bytes(new ByteArrayInputStream(new byte[6]), 5));
        assertThrows(BadRequestResponse.class, () -> Validation.imageExtension("<svg onload='alert(1)'/>".getBytes()));
        var img = new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB); var output = new ByteArrayOutputStream(); javax.imageio.ImageIO.write(img,"png",output);
        assertEquals("png", Validation.imageExtension(output.toByteArray()));
    }
    @Test void helperPasswordHashHasAdequateWorkFactor() throws Exception {
        String hash = PasswordHasherHelper.hashForStorage("test-password-not-used-in-production");
        assertTrue(Integer.parseInt(hash.split(":")[0]) >= 600000);
        assertTrue(PasswordHasherHelper.verifyPassword("test-password-not-used-in-production", hash));
        assertFalse(PasswordHasherHelper.verifyPassword("wrong-password", hash));
    }
}
