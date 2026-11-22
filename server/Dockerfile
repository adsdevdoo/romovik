ARG BASE_IMAGE=eclipse-temurin:21-jre-jammy@sha256:a8bff88f760e87e0c8844f8461f807c203fd5e8f78c951c843024647e965eaf5
FROM ${BASE_IMAGE}
WORKDIR /app
COPY target/romovik-server-1.0.0.jar /app/server.jar
USER 10001:10001
ENV BIND_HOST=0.0.0.0 PORT=8080 JAVA_TOOL_OPTIONS="-Xmx384m -XX:+ExitOnOutOfMemoryError -Djava.awt.headless=true"
ENTRYPOINT ["java", "-jar", "/app/server.jar"]
