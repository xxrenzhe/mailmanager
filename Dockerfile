# 多阶段构建优化镜像大小
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖（仅生产环境）
RUN npm ci --only=production && npm cache clean --force

# 运行时阶段
FROM node:18-alpine AS runtime

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mailmanager -u 1001

# 设置工作目录
WORKDIR /app

# 从构建阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 复制应用文件
COPY --chown=mailmanager:nodejs proxy-server.js ./
COPY --chown=mailmanager:nodejs simple-mail-manager.html ./
COPY --chown=mailmanager:nodejs server/ ./server/
COPY --chown=mailmanager:nodejs public/ ./public/

# 创建必要的目录并设置权限
RUN mkdir -p /app/data /app/logs && \
    chown -R mailmanager:nodejs /app/data /app/logs

# 切换到非 root 用户
USER mailmanager

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# 设置环境变量
ENV NODE_ENV=production
ENV PROXY_PORT=3001

# 启动命令
CMD ["node", "proxy-server.js"]