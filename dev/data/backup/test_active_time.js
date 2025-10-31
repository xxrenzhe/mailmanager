const http = require('http');

// 模拟收到新验证码并更新活跃时间
const testCodeData = {
  account_id: 10, // JoelGrundydi@outlook.com
  code: "888999",
  subject: "Test verification code",
  sender: "test@service.com",
  received_at: new Date().toISOString(),
  created_at: new Date().toISOString()
};

const postData = JSON.stringify(testCodeData);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/codes',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);

  res.setEncoding('utf8');
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`响应: ${body}`);

    // 检查账户列表看看活跃时间是否更新
    console.log('\n检查账户列表...');
    const listReq = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/accounts/paged',
      method: 'GET'
    }, (listRes) => {
      let listBody = '';
      listRes.on('data', (chunk) => listBody += chunk);
      listRes.on('end', () => {
        const accounts = JSON.parse(listBody);
        const joelAccount = accounts.accounts.find(a => a.id === 10);
        if (joelAccount) {
          console.log(`JoelGrundydi活跃时间: ${joelAccount.last_active_at}`);
          console.log(`新验证码时间: ${testCodeData.received_at}`);
          console.log(`时间匹配: ${joelAccount.last_active_at === testCodeData.received_at ? '✅' : '❌'}`);
        }
      });
    });
    listReq.end();
  });
});

req.on('error', (e) => {
  console.error(`请求遇到问题: ${e.message}`);
});

req.write(postData);
req.end();