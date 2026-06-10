FROM node:20-alpine AS build
WORKDIR /app

# Vite injeta VITE_* em BUILD time — sem isso o bundle sobe com Supabase quebrado.
# Falha cedo e alto se faltar (build args vêm do docker-compose via .env raiz).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN test -n "$VITE_SUPABASE_URL" || (echo "ERRO: build arg VITE_SUPABASE_URL ausente — defina no .env raiz" && exit 1)
RUN test -n "$VITE_SUPABASE_ANON_KEY" || (echo "ERRO: build arg VITE_SUPABASE_ANON_KEY ausente — defina no .env raiz" && exit 1)

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
