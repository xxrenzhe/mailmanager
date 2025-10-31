const http = require('http');

console.log('🧪 测试邮箱删除功能 - 验证所有数据是否被清除...');

async function testDeleteFunctionality() {
    try {
        // 1. 获取当前账户列表
        console.log('\n📋 获取当前账户列表...');
        const accounts = await getAccounts();

        if (accounts.length === 0) {
            console.log('❌ 没有找到任何账户，无法测试删除功能');
            return;
        }

        // 选择第一个账户进行测试
        const testAccount = accounts[0];
        console.log(`🎯 选择测试账户: ${testAccount.email} (ID: ${testAccount.id})`);

        // 2. 记录删除前的数据状态
        console.log('\n📊 记录删除前的数据状态...');
        const beforeStats = await getAccountStats(testAccount.id);
        console.log(`  验证码数量: ${beforeStats.codes}`);
        console.log(`  消息数量: ${beforeStats.messages}`);

        // 3. 执行删除操作
        console.log('\n🗑️ 执行删除操作...');
        const deleteResult = await deleteAccount(testAccount.id);
        console.log(`  删除结果: ${deleteResult.success ? '成功' : '失败'}`);
        console.log(`  响应消息: ${deleteResult.message}`);

        // 4. 验证删除后的数据状态
        console.log('\n🔍 验证删除后的数据状态...');

        // 检查账户是否还存在
        const remainingAccounts = await getAccounts();
        const accountStillExists = remainingAccounts.some(acc => acc.id === testAccount.id);
        console.log(`  账户是否还存在: ${accountStillExists ? '❌ 是' : '✅ 否'}`);

        // 检查相关数据是否被删除
        const afterStats = await getAccountStats(testAccount.id);
        console.log(`  删除后验证码数量: ${afterStats.codes}`);
        console.log(`  删除后消息数量: ${afterStats.messages}`);

        // 5. 总结测试结果
        console.log('\n🏆 测试结果总结:');
        if (!accountStillExists && afterStats.codes === 0 && afterStats.messages === 0) {
            console.log('  ✅ 删除功能正常：账户及所有相关数据已被完全清除');
        } else {
            console.log('  ❌ 删除功能存在问题：');
            if (accountStillExists) console.log('    - 账户记录仍然存在');
            if (afterStats.codes > 0) console.log('    - 验证码记录未被清除');
            if (afterStats.messages > 0) console.log('    - 消息记录未被清除');
        }

    } catch (error) {
        console.error('❌ 测试过程中发生错误:', error.message);
    }
}

async function getAccounts() {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/accounts/paged',
            method: 'GET'
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data.accounts || []);
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function getAccountStats(accountId) {
    return new Promise((resolve) => {
        // 直接查询数据库获取统计信息
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('/Users/jason/Documents/Kiro/mailmanager/data/mailmanager.db');

        const stats = { codes: 0, messages: 0 };

        db.get('SELECT COUNT(*) as count FROM codes WHERE account_id = ?', [accountId], (err, row) => {
            if (!err && row) stats.codes = row.count;

            db.get('SELECT COUNT(*) as count FROM messages WHERE account_id = ?', [accountId], (err, row) => {
                if (!err && row) stats.messages = row.count;
                db.close();
                resolve(stats);
            });
        });
    });
}

async function deleteAccount(accountId) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: `/api/accounts/${accountId}`,
            method: 'DELETE'
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve({
                        success: res.statusCode === 200,
                        message: data.message || data.error || '未知响应',
                        statusCode: res.statusCode
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// 执行测试
testDeleteFunctionality().then(() => {
    console.log('\n🎯 测试完成');
}).catch(error => {
    console.error('❌ 测试失败:', error);
});