# ============================================
# Stage 1: Base & Development (Hot Reload)
# ============================================
FROM maven:3.9-eclipse-temurin-21-alpine AS dev

WORKDIR /app

# Copiar archivos de configuración para cachear dependencias
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copiamos el código fuente directamente
COPY src/ src/

# Exponemos el puerto de Spring Boot
EXPOSE 8090

# USAMOS 'mvn' en lugar de './mvnw'
CMD ["mvn", "spring-boot:run"]

# ============================================
# Stage 2: Build (Para producción)
# ============================================
FROM dev AS build
RUN mvn package -DskipTests -B

# ============================================
# Stage 3: Runtime (Producción ultra-ligera)
# ============================================
FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=build /app/target/*.jar app.jar
USER appuser
EXPOSE 8090
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]