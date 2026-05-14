# ============================================
# Stage 1: Base & Development
# ============================================
FROM node:20-alpine AS dev

WORKDIR /app

# Copiar archivos de dependencias
COPY package.json package-lock.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Exponemos el puerto de Vite
EXPOSE 3000

# Por defecto, corremos el modo desarrollo
CMD ["npm", "run", "dev", "--", "--host", "--port", "3000"]

# ============================================
# Stage 2: Build (Solo para producción)
# ============================================
FROM dev AS build
RUN npm run build

# ============================================
# Stage 3: Runtime (Solo para producción)
# ============================================
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]