const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Yahoo IMAP配置
const imapConfig = {
    user: 'GuarinLadayjakV@yahoo.com',
    password: 'fvuociwnxpezxssf',
    host: 'imap.mail.yahoo.com',
    port: 993,
    tls: true,
    connTimeout: 60000,
    authTimeout: 60000,
    tlsOptions: {
        rejectUnauthorized: false,
        servername: 'imap.mail.yahoo.com'
    }
};

async function testYahooFixed() {
    console.log('🧪 测试修复后的Yahoo邮件主题提取...');

    return new Promise((resolve, reject) => {
        const imap = new Imap(imapConfig);

        imap.once('ready', () => {
            console.log('✅ IMAP连接成功');

            imap.openBox('INBOX', true, (err, box) => {
                if (err) {
                    console.error('❌ 打开收件箱失败:', err);
                    imap.end();
                    return reject(err);
                }

                console.log(`📬 收件箱打开成功，邮件总数: ${box.messages.total}`);

                // 获取最新的3封邮件
                const fetchCount = Math.min(box.messages.total, 3);
                const startSeq = Math.max(1, box.messages.total - fetchCount + 1);
                const range = `${startSeq}:${box.messages.total}`;

                console.log(`🔍 获取邮件范围: ${range}`);

                const fetch = imap.fetch(range, {
                    bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', 'TEXT'],
                    struct: true
                });

                let processedCount = 0;
                const results = [];

                fetch.on('message', (msg, seqno) => {
                    let headerBuffer = '';
                    let textBuffer = '';
                    let messageId = '';

                    msg.on('body', (stream, info) => {
                        stream.on('data', (chunk) => {
                            if (info.which.includes('HEADER')) {
                                headerBuffer += chunk.toString('utf8');
                            } else if (info.which === 'TEXT') {
                                textBuffer += chunk.toString('utf8');
                            }
                        });

                        stream.once('end', async () => {
                            if (info.which.includes('HEADER')) {
                                const headers = Imap.parseHeader(headerBuffer);
                                messageId = headers['message-id']?.[0] || `msg_${seqno}`;
                                console.log(`\n📧 邮件 #${seqno} IMAP头部解析:`);
                                console.log(`  - Subject: "${headers.subject?.[0] || '(无主题)'}"`);
                                console.log(`  - From: ${headers.from?.[0] || '(未知)'}`);
                            }
                        });
                    });

                    msg.once('attributes', async (attrs) => {
                        // 获取完整邮件内容
                        const fullFetch = imap.fetch(attrs.uid, { bodies: 'TEXT' });

                        fullFetch.on('message', (fullMsg, fullSeqno) => {
                            let fullBuffer = '';

                            fullMsg.on('body', (stream, info) => {
                                stream.on('data', (chunk) => {
                                    fullBuffer += chunk.toString('utf8');
                                });

                                stream.once('end', async () => {
                                    try {
                                        const parsed = await simpleParser(fullBuffer);

                                        console.log(`📋 邮件 #${seqno} mailparser解析:`);
                                        console.log(`  - Original Subject: "${parsed.subject || '(无主题)'}"`);
                                        console.log(`  - From: ${parsed.from?.value?.[0]?.address || '(未知)'}`);

                                        // 🎯 应用修复逻辑：从HTML title标签提取发件人信息
                                        let extractedSubject = parsed.subject;
                                        if (!extractedSubject && (parsed.html || parsed.text)) {
                                            const content = parsed.html || parsed.text;
                                            console.log(`🔍 尝试从邮件内容提取主题...`);

                                            // 查找HTML title标签
                                            const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
                                            if (titleMatch) {
                                                extractedSubject = titleMatch[1].replace(/=\s*\n/g, '').trim();
                                                console.log(`✅ 从HTML title提取到主题: "${extractedSubject}"`);
                                            } else {
                                                // 备用方案：查找"Sign in to"模式
                                                const signInMatch = content.match(/sign in to ([^\s\n]+)/i);
                                                if (signInMatch) {
                                                    extractedSubject = `Sign in to ${signInMatch[1]}`;
                                                    console.log(`✅ 从Sign in to模式提取到主题: "${extractedSubject}"`);
                                                } else {
                                                    console.log(`❌ 未能从邮件内容提取主题`);
                                                }
                                            }
                                        }

                                        // 查找验证码
                                        const codeMatches = (parsed.html || parsed.text || '').match(/\b\d{4,8}\b/g);
                                        const verificationCodes = codeMatches ? [...new Set(codeMatches)] : [];

                                        const result = {
                                            email: 'GuarinLadayjakV@yahoo.com',
                                            messageId: messageId,
                                            originalSubject: parsed.subject || '(无主题)',
                                            extractedSubject: extractedSubject || '(无主题)',
                                            from: parsed.from?.value?.[0]?.address || '(未知)',
                                            verificationCodes: verificationCodes,
                                            hasExtractedSubject: !!extractedSubject && extractedSubject !== '(无主题)'
                                        };

                                        results.push(result);
                                        processedCount++;

                                        console.log(`🎯 最终结果:`);
                                        console.log(`  - 最终Subject: "${result.extractedSubject}"`);
                                        console.log(`  - 验证码: ${verificationCodes.join(', ') || '(无)'}`);
                                        console.log(`  - 成功提取主题: ${result.hasExtractedSubject ? '✅' : '❌'}`);

                                        if (processedCount === fetchCount) {
                                            console.log('\n📊 测试总结:');
                                            console.log(`总测试邮件: ${results.length}`);
                                            console.log(`成功提取主题: ${results.filter(r => r.hasExtractedSubject).length}`);
                                            console.log(`包含验证码: ${results.filter(r => r.verificationCodes.length > 0).length}`);

                                            results.forEach((r, i) => {
                                                console.log(`\n邮件${i + 1}:`);
                                                console.log(`  主题: ${r.extractedSubject}`);
                                                console.log(`  验证码: ${r.verificationCodes.join(', ') || '(无)'}`);
                                            });

                                            imap.end();
                                            resolve(results);
                                        }
                                    } catch (parseError) {
                                        console.error(`❌ 解析邮件失败:`, parseError);
                                        processedCount++;

                                        if (processedCount === fetchCount) {
                                            imap.end();
                                            resolve(results);
                                        }
                                    }
                                });
                            });
                        });
                    });
                });

                fetch.once('error', (err) => {
                    console.error('❌ 获取邮件失败:', err);
                    imap.end();
                    reject(err);
                });
            });
        });

        imap.once('error', (err) => {
            console.error('❌ IMAP连接错误:', err);
            reject(err);
        });

        imap.once('end', () => {
            console.log('🔚 IMAP连接结束');
        });

        console.log('🔄 正在连接到Yahoo IMAP服务器...');
        imap.connect();
    });
}

// 运行测试
testYahooFixed().then(results => {
    console.log('\n🎉 测试完成!');
    process.exit(0);
}).catch(error => {
    console.error('💥 测试失败:', error);
    process.exit(1);
});