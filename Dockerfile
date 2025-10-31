# 多阶段构建：Node.js 应用构建
FROM node:18-alpine AS node-builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖（仅生产环境）
RUN npm ci --only=production && npm cache clean --force

# Nginx 反向代理阶段
FROM nginx:alpine AS nginx

# 安装必要的工具和Node.js
RUN apk add --no-cache supervisor nodejs npm curl

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mailmanager -u 1001

# 设置工作目录
WORKDIR /app

# 从 Node.js 构建阶段复制 node_modules
COPY --from=node-builder /app/node_modules ./node_modules

# 复制应用文件
COPY --chown=mailmanager:nodejs proxy-server.js ./
COPY --chown=mailmanager:nodejs simple-mail-manager.html ./
COPY --chown=mailmanager:nodejs public/ ./public/
COPY --chown=mailmanager:nodejs server/ ./server/

# 创建必要的目录并设置权限
RUN mkdir -p /app/data /app/etc && \
    chown -R mailmanager:nodejs /app/data

# 创建 nginx 配置
RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name localhost;

    # 主要应用代理
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 请求大小限制
        client_max_body_size 50M;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # SSE 流处理（特殊配置）
    location /api/events/stream {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 特殊配置
        proxy_cache off;
        proxy_buffering off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;

        # 长连接设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }

    # 健康检查端点
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

# 创建 supervisord 配置目录和配置文件
RUN mkdir -p /etc/supervisor/conf.d && \
    cat > /etc/supervisor/conf.d/mailmanager.conf << 'EOF'
[supervisord]
nodaemon=true
user=root

[program:nginx]
command=nginx -g "daemon off;"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=true
priority=10

[program:mailmanager]
command=node /app/proxy-server.js
directory=/app
user=mailmanager
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=true
priority=20

[program:health-check]
command=/bin/sh -c "while true; do sleep 30; curl -f http://localhost/health || exit 1; done"
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
autorestart=true
priority=30
EOF

# 设置脚本权限
RUN chmod +x /etc/supervisor/conf.d/mailmanager.conf

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

# 设置环境变量
ENV NODE_ENV=production
ENV PROXY_PORT=3001

# 启动命令（使用 supervisord 同时运行 nginx 和 Node.js）
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/mailmanager.conf"]