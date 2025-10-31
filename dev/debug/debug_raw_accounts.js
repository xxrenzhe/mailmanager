/**
 * 使用原生SQL查询调试账户信息
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function debugRawAccounts() {
    const dbPath = path.join(__dirname, 'data', 'mailmanager.db');

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                reject(err);
                return;
            }

            console.log('=== 原生SQL查询调试 ===');

            // 查询前10个账户的完整信息
            const sql = `
                SELECT
                    id, email, client_id, refresh_token_enc, status,
                    length(refresh_token_enc) as token_length,
                    last_active_at, created_at, updated_at
                FROM accounts
                WHERE is_active = 1
                ORDER BY id
                LIMIT 10
            `;

            db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                console.log(`查询到 ${rows.length} 个账户:`);

                rows.forEach((row, index) => {
                    console.log(`\n${index + 1}. ID: ${row.id}`);
                    console.log(`   Email: ${row.email}`);
                    console.log(`   Client ID: ${row.client_id ? '有' : '无'}`);
                    console.log(`   Refresh Token: ${row.refresh_token_enc ? `有(${row.token_length}字符)` : '无'}`);
                    console.log(`   Status: ${row.status}`);
                    console.log(`   Last Active: ${row.last_active_at || '无'}`);
                });

                // 查询有refresh_token的账户数量
                const countSql = `
                    SELECT COUNT(*) as count
                    FROM accounts
                    WHERE refresh_token_enc IS NOT NULL
                    AND client_id IS NOT NULL
                    AND is_active = 1
                `;

                db.get(countSql, [], (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    console.log(`\n有完整认证信息的账户数量: ${result.count}`);

                    // 获取几个有token的账户用于测试
                    const testSql = `
                        SELECT id, email, client_id, refresh_token_enc
                        FROM accounts
                        WHERE refresh_token_enc IS NOT NULL
                        AND client_id IS NOT NULL
                        AND is_active = 1
                        LIMIT 3
                    `;

                    db.all(testSql, [], (err, testRows) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        console.log('\n可用于测试的账户:');
                        testRows.forEach((row, index) => {
                            console.log(`${index + 1}. ${row.email} (ID: ${row.id})`);
                        });

                        db.close((closeErr) => {
                            if (closeErr) {
                                console.error('关闭数据库失败:', closeErr);
                            }
                            resolve(testRows);
                        });
                    });
                });
            });
        });
    });
}

debugRawAccounts()
    .then((testAccounts) => {
        console.log('\n✅ 调试完成');
        console.log('可用于测试的账户数量:', testAccounts.length);
    })
    .catch((error) => {
        console.error('❌ 调试失败:', error);
    });