package rs.creepypaste.romovik;

import org.bson.Document;
import io.javalin.http.BadRequestResponse;
import javax.imageio.ImageIO;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

final class Validation {
    static final int DUMP_LIMIT = 16 * 1024 * 1024, PHOTO_LIMIT = 8 * 1024 * 1024;
    static final Set<String> TYPES = Set.of("EPROM", "EEPROM", "Flash", "ROM", "Другое");
    static String text(Document data, String key, int limit, boolean required) {
        Object raw = data.getOrDefault(key, "");
        if (!(raw instanceof String value) || value.length() > limit || value.indexOf('\0') >= 0 || (required && value.isBlank()))
            throw new BadRequestResponse("Проверьте поле «" + key + "».");
        return value.strip();
    }
    static String id(String value) {
        if (value == null || !value.matches("[a-z0-9]+(?:-[a-z0-9]+)*") || value.length() > 100) throw new BadRequestResponse("Некорректный идентификатор.");
        return value;
    }
    static String filename(String name) {
        if (name == null || name.isBlank() || name.length() > 180 || name.chars().anyMatch(c -> c < 32 || c == 127 || c == '\\' || c == '/' || c == ':')) throw new BadRequestResponse("Некорректное имя файла.");
        return name;
    }
    static String hash(byte[] data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    static byte[] bytes(InputStream input, int limit) throws IOException {
        try (input) {
            byte[] value = input.readNBytes(limit + 1);
            if (value.length == 0 || value.length > limit) throw new BadRequestResponse("Файл пустой или превышает допустимый размер.");
            return value;
        }
    }
    static String imageExtension(byte[] bytes) throws IOException {
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw new BadRequestResponse("Фотография должна быть PNG или JPEG.");
            var reader = readers.next();
            try {
                reader.setInput(stream);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!Set.of("png", "jpeg").contains(format)) throw new BadRequestResponse("Фотография должна быть PNG или JPEG.");
                int w = reader.getWidth(0), h = reader.getHeight(0);
                if (w < 1 || h < 1 || (long) w * h > 16_000_000) throw new BadRequestResponse("Фотография должна быть не больше 16 мегапикселей.");
                if (reader.read(0) == null) throw new BadRequestResponse("Не удалось прочитать фотографию.");
                return format.equals("jpeg") ? "jpg" : "png";
            } finally { reader.dispose(); }
        } catch (javax.imageio.IIOException e) { throw new BadRequestResponse("Повреждённая фотография."); }
    }
    static Document metadata(Document input) {
        var result = new Document();
        for (String field : List.of("chip", "manufacturer", "package", "label", "device", "board", "programmer", "profile"))
            result.put(field, text(input, field, field.equals("label") ? 1000 : 160, field.equals("chip") || field.equals("manufacturer") || field.equals("label")));
        for (String field : List.of("description", "notes")) result.put(field, text(input, field, 8000, false));
        String type = text(input, "type", 20, true);
        if (!TYPES.contains(type)) throw new BadRequestResponse("Неизвестный тип памяти.");
        result.put("type", type);
        String origin = text(input, "origin", 20, true);
        if (!Set.of("known", "uncertain", "unknown").contains(origin)) throw new BadRequestResponse("Проверьте происхождение.");
        result.put("origin", origin);
        return result;
    }
    static List<Document> strings(Document data, byte[] dump) {
        Object raw = data.get("strings");
        if (!(raw instanceof List<?> list) || list.size() > 100) throw new BadRequestResponse("Строки: не больше 100 фрагментов.");
        var result = new ArrayList<Document>();
        for (Object entry : list) {
            if (!(entry instanceof Document item) || !(item.get("offset") instanceof Number offset)) throw new BadRequestResponse("Проверьте смещения строк.");
            text(item, "text", 500, true);
            String text = item.getString("text"); // Keep exact spaces and byte offsets.
            long start = offset.longValue();
            if (offset.doubleValue() != start || start < 0 || start > dump.length - text.length() || !text.matches("[\\x20-\\x7e]+") || !text.equals(new String(dump, (int) start, text.length(), StandardCharsets.US_ASCII)))
                throw new BadRequestResponse("Строка не совпадает с байтами дампа.");
            result.add(new Document("offset", start).append("encoding", "ASCII").append("text", text));
        }
        return result;
    }
    static List<Document> candidates(byte[] data) {
        var result = new ArrayList<Document>();
        for (int start = 0, end = 0; end <= data.length; end++) {
            if (end < data.length && data[end] >= 32 && data[end] <= 126) continue;
            int size = end - start;
            if (size >= 6 && size <= 160) {
                String text = new String(data, start, size, StandardCharsets.US_ASCII);
                if (text.matches(".*[A-Za-z]{4}.*")) result.add(new Document("offset", start).append("encoding", "ASCII").append("text", text));
            }
            start = end + 1;
            if (result.size() >= 300) break;
        }
        return result;
    }
}
