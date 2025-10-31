const EventEmitter = require('events');

class LoadBalancer extends EventEmitter {
  constructor(options = {}) {
    super();

    // 节点配置
    this.nodes = new Map(); // nodeId -> node info
    this.healthyNodes = new Set(); // 健康节点集合

    // 负载均衡策略
    this.strategy = options.strategy || 'round-robin'; // round-robin, least-connections, weighted, ip-hash
    this.currentIndex = 0;

    // 健康检查配置
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30秒
    this.healthCheckTimeout = options.healthCheckTimeout || 5000; // 5秒
    this.maxFailures = options.maxFailures || 3; // 最大失败次数

    // 会话粘性
    this.sessionAffinity = options.sessionAffinity || false;
    this.sessionMap = new Map(); // sessionId -> nodeId

    // 性能监控
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      nodeMetrics: new Map() // nodeId -> node metrics
    };

    // 故障转移
    this.failoverEnabled = options.failoverEnabled !== false;
    this.circuitBreakers = new Map(); // nodeId -> circuit breaker state

    this.init();
  }

  init() {
    // 启动健康检查
    this.startHealthCheck();

    console.log(`[LoadBalancer] 负载均衡器已初始化, 策略: ${this.strategy}`);
  }

  // 添加节点
  addNode(nodeId, nodeConfig) {
    const node = {
      id: nodeId,
      host: nodeConfig.host,
      port: nodeConfig.port,
      weight: nodeConfig.weight || 1,
      maxConnections: nodeConfig.maxConnections || 100,
      currentConnections: 0,
      status: 'unknown',
      lastHealthCheck: 0,
      failureCount: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      responseTimes: []
    };

    this.nodes.set(nodeId, node);
    this.healthyNodes.add(nodeId);

    // 初始化熔断器
    this.circuitBreakers.set(nodeId, {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailureTime: 0,
      successCount: 0
    });

    console.log(`[LoadBalancer] 添加节点: ${nodeId} (${node.host}:${node.port})`);
    this.emit('nodeAdded', { nodeId, node });
  }

  // 移除节点
  removeNode(nodeId) {
    this.nodes.delete(nodeId);
    this.healthyNodes.delete(nodeId);
    this.circuitBreakers.delete(nodeId);

    console.log(`[LoadBalancer] 移除节点: ${nodeId}`);
    this.emit('nodeRemoved', { nodeId });
  }

  // 选择节点（负载均衡核心逻辑）
  selectNode(sessionId = null) {
    const availableNodes = this.getAvailableNodes();

    if (availableNodes.length === 0) {
      throw new Error('没有可用的节点');
    }

    let selectedNode;

    // 会话粘性
    if (this.sessionAffinity && sessionId) {
      const affinityNodeId = this.sessionMap.get(sessionId);
      if (affinityNodeId && this.healthyNodes.has(affinityNodeId)) {
        selectedNode = this.nodes.get(affinityNodeId);
      }
    }

    // 负载均衡策略
    if (!selectedNode) {
      switch (this.strategy) {
        case 'round-robin':
          selectedNode = this.roundRobinSelect(availableNodes);
          break;
        case 'least-connections':
          selectedNode = this.leastConnectionsSelect(availableNodes);
          break;
        case 'weighted':
          selectedNode = this.weightedSelect(availableNodes);
          break;
        case 'ip-hash':
          selectedNode = this.ipHashSelect(availableNodes, sessionId);
          break;
        default:
          selectedNode = this.roundRobinSelect(availableNodes);
      }
    }

    // 检查节点容量
    if (selectedNode.currentConnections >= selectedNode.maxConnections) {
      // 递归选择下一个节点
      const filteredNodes = availableNodes.filter(n => n.id !== selectedNode.id);
      if (filteredNodes.length > 0) {
        return this.selectNode(sessionId);
      } else {
        throw new Error('所有节点都已达到最大连接数');
      }
    }

    // 更新会话映射
    if (this.sessionAffinity && sessionId) {
      this.sessionMap.set(sessionId, selectedNode.id);
    }

    // 更新节点连接数
    selectedNode.currentConnections++;
    selectedNode.totalRequests++;

    console.log(`[LoadBalancer] 选择节点: ${selectedNode.id} (连接数: ${selectedNode.currentConnections})`);
    return selectedNode;
  }

  // 轮询选择
  roundRobinSelect(nodes) {
    const node = nodes[this.currentIndex % nodes.length];
    this.currentIndex++;
    return node;
  }

  // 最少连接选择
  leastConnectionsSelect(nodes) {
    return nodes.reduce((min, current) =>
      current.currentConnections < min.currentConnections ? current : min
    );
  }

  // 权重选择
  weightedSelect(nodes) {
    const totalWeight = nodes.reduce((sum, node) => sum + node.weight, 0);
    let random = Math.random() * totalWeight;

    for (const node of nodes) {
      random -= node.weight;
      if (random <= 0) {
        return node;
      }
    }

    return nodes[nodes.length - 1];
  }

  // IP哈希选择
  ipHashSelect(nodes, sessionId) {
    if (!sessionId) {
      return this.roundRobinSelect(nodes);
    }

    const hash = this.hashCode(sessionId);
    const index = Math.abs(hash) % nodes.length;
    return nodes[index];
  }

  // 哈希函数
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return hash;
  }

  // 释放节点连接
  releaseNode(nodeId, success = true, responseTime = 0) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.currentConnections = Math.max(0, node.currentConnections - 1);

    if (success) {
      node.successfulRequests++;
      this.metrics.successfulRequests++;

      // 更新响应时间
      node.responseTimes.push(responseTime);
      if (node.responseTimes.length > 100) {
        node.responseTimes = node.responseTimes.slice(-50);
      }
      node.averageResponseTime = node.responseTimes.reduce((a, b) => a + b, 0) / node.responseTimes.length;

      // 熔断器成功
      const breaker = this.circuitBreakers.get(nodeId);
      if (breaker.state === 'half-open') {
        breaker.successCount++;
        if (breaker.successCount >= 3) {
          breaker.state = 'closed';
          breaker.failureCount = 0;
          console.log(`[LoadBalancer] 熔断器恢复: ${nodeId}`);
        }
      }
    } else {
      node.failedRequests++;
      this.metrics.failedRequests++;

      // 熔断器失败处理
      this.handleCircuitBreakerFailure(nodeId);
    }

    // 更新平均响应时间
    this.updateAverageResponseTime(responseTime);
  }

  // 处理熔断器失败
  handleCircuitBreakerFailure(nodeId) {
    const breaker = this.circuitBreakers.get(nodeId);
    if (!breaker) return;

    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();

    // 检查是否需要打开熔断器
    if (breaker.state === 'closed' && breaker.failureCount >= this.maxFailures) {
      breaker.state = 'open';
      this.healthyNodes.delete(nodeId);
      console.log(`[LoadBalancer] 熔断器打开: ${nodeId} (失败次数: ${breaker.failureCount})`);
    } else if (breaker.state === 'half-open') {
      breaker.state = 'open';
      this.healthyNodes.delete(nodeId);
    }

    // 设置熔断器恢复定时器
    if (breaker.state === 'open') {
      setTimeout(() => {
        if (breaker.state === 'open') {
          breaker.state = 'half-open';
          breaker.successCount = 0;
          this.healthyNodes.add(nodeId);
          console.log(`[LoadBalancer] 熔断器半开: ${nodeId}`);
        }
      }, 30000); // 30秒后尝试恢复
    }
  }

  // 获取可用节点
  getAvailableNodes() {
    return Array.from(this.healthyNodes)
      .map(nodeId => this.nodes.get(nodeId))
      .filter(node => node && node.status === 'healthy');
  }

  // 健康检查
  async startHealthCheck() {
    setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  // 执行健康检查
  async performHealthCheck() {
    const healthCheckPromises = Array.from(this.nodes.keys()).map(nodeId =>
      this.checkNodeHealth(nodeId)
    );

    await Promise.allSettled(healthCheckPromises);
  }

  // 检查单个节点健康状态
  async checkNodeHealth(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    try {
      // 模拟健康检查（实际应用中应该调用节点的健康检查API）
      const startTime = Date.now();
      const isHealthy = await this.pingNode(node);
      const responseTime = Date.now() - startTime;

      if (isHealthy) {
        node.status = 'healthy';
        node.lastHealthCheck = Date.now();
        node.failureCount = 0;

        // 如果节点之前不健康，现在恢复了
        if (!this.healthyNodes.has(nodeId)) {
          this.healthyNodes.add(nodeId);
          this.circuitBreakers.get(nodeId).state = 'closed';
          console.log(`[LoadBalancer] 节点恢复健康: ${nodeId}`);
        }
      } else {
        throw new Error('节点不响应');
      }

    } catch (error) {
      node.status = 'unhealthy';
      node.failureCount++;
      node.lastHealthCheck = Date.now();

      this.healthyNodes.delete(nodeId);
      this.handleCircuitBreakerFailure(nodeId);

      console.log(`[LoadBalancer] 节点不健康: ${nodeId} (失败次数: ${node.failureCount})`);
    }
  }

  // 模拟节点ping
  async pingNode(node) {
    // 实际应用中应该调用节点的健康检查端点
    // 这里模拟网络延迟和随机失败
    return new Promise((resolve) => {
      setTimeout(() => {
        // 95%的概率成功
        resolve(Math.random() > 0.05);
      }, Math.random() * 1000 + 100);
    });
  }

  // 获取负载均衡状态
  getStatus() {
    const nodeStatuses = Array.from(this.nodes.entries()).map(([nodeId, node]) => ({
      nodeId,
      host: node.host,
      port: node.port,
      status: node.status,
      currentConnections: node.currentConnections,
      maxConnections: node.maxConnections,
      totalRequests: node.totalRequests,
      successfulRequests: node.successfulRequests,
      failedRequests: node.failedRequests,
      averageResponseTime: node.averageResponseTime,
      circuitBreakerState: this.circuitBreakers.get(nodeId)?.state || 'closed'
    }));

    return {
      strategy: this.strategy,
      totalNodes: this.nodes.size,
      healthyNodes: this.healthyNodes.size,
      unhealthyNodes: this.nodes.size - this.healthyNodes.size,
      metrics: {
        ...this.metrics,
        hitRate: this.metrics.totalRequests > 0
          ? (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2) + '%'
          : '0%'
      },
      nodes: nodeStatuses
    };
  }

  // 更新平均响应时间
  updateAverageResponseTime(responseTime) {
    const alpha = 0.1;
    this.metrics.averageResponseTime =
      this.metrics.averageResponseTime * (1 - alpha) + responseTime * alpha;
  }

  // 获取节点详细信息
  getNodeInfo(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    return {
      ...node,
      circuitBreaker: this.circuitBreakers.get(nodeId),
      isActive: this.healthyNodes.has(nodeId)
    };
  }

  // 动态调整权重
  adjustWeight(nodeId, newWeight) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.weight = Math.max(1, newWeight);
      console.log(`[LoadBalancer] 调整权重: ${nodeId} -> ${newWeight}`);
    }
  }

  // 动态调整最大连接数
  adjustMaxConnections(nodeId, newMaxConnections) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.maxConnections = Math.max(1, newMaxConnections);
      console.log(`[LoadBalancer] 调整最大连接数: ${nodeId} -> ${newMaxConnections}`);
    }
  }

  // 清理会话映射
  clearSessionMap() {
    this.sessionMap.clear();
    console.log('[LoadBalancer] 会话映射已清空');
  }

  // 销毁负载均衡器
  destroy() {
    this.nodes.clear();
    this.healthyNodes.clear();
    this.sessionMap.clear();
    this.circuitBreakers.clear();

    console.log('[LoadBalancer] 负载均衡器已销毁');
  }
}

module.exports = LoadBalancer;