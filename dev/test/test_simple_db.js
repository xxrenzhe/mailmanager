/**
 * Simple database test to debug the initialization issue
 */

const Database = require('./server/database');

async function testSimpleDB() {
    console.log('开始简单数据库测试...');

    const db = new Database('./data/mailmanager.db');

    try {
        await db.init();
        console.log('✅ 数据库初始化成功');

        // Test basic operations
        const result = await db.get('SELECT COUNT(*) as count FROM accounts');
        console.log(`✅ 查询测试成功，accounts表有 ${result.count} 条记录`);

        // Test if the email_processing_history table exists
        const tableExists = await db.get(`
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='email_processing_history'
        `);

        if (tableExists) {
            console.log('✅ email_processing_history 表已存在');

            // Test inserting a record
            const insertResult = await db.run(`
                INSERT INTO email_processing_history
                (account_id, message_id, processed_at, processing_time_ms, codes_found, status)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [1024, 'test_msg_' + Date.now(), new Date().toISOString(), 150, 1, 'success']);

            console.log(`✅ 插入测试成功，ID: ${insertResult.id}`);

        } else {
            console.log('❌ email_processing_history 表不存在');
        }

    } catch (error) {
        console.error('❌ 测试失败:', error);
    } finally {
        await db.close();
        console.log('数据库连接已关闭');
    }
}

testSimpleDB();