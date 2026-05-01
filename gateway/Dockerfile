ARG NODE_BASE_IMAGE=node:22-alpine
ARG NGINX_BASE_IMAGE=nginx:1.27-alpine
ARG BUILDPLATFORM
ARG TARGETPLATFORM

FROM --platform=$BUILDPLATFORM ${NODE_BASE_IMAGE} AS web-builder

ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app/web
COPY web/package*.json ./
RUN npm config set registry "${NPM_REGISTRY}" && \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY web /app/web
RUN npm run build

FROM --platform=$TARGETPLATFORM ${NGINX_BASE_IMAGE}

COPY gateway/nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/web/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
