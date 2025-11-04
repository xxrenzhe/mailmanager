const Imap = require('imap');

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

function debugYahooImap() {
    console.log('🔍 开始调试Yahoo IMAP邮件主题提取...');

    const imap = new Imap(imapConfig);

    imap.once('ready', () => {
        console.log('✅ IMAP连接成功');

        imap.openBox('INBOX', true, (err, box) => {
            if (err) {
                console.error('❌ 打开收件箱失败:', err);
                imap.end();
                return;
            }

            console.log(`📬 收件箱打开成功，邮件总数: ${box.messages.total}`);

            // 搜索最近5天的邮件
            const searchCriteria = ['UNSEEN', ['SINCE', '01-Nov-2025']];
            console.log('🔍 搜索条件:', searchCriteria);

            imap.search(searchCriteria, (err, results) => {
                if (err) {
                    console.error('❌ 搜索邮件失败:', err);
                    imap.end();
                    return;
                }

                if (results.length === 0) {
                    console.log('📭 没有找到未读邮件，搜索最近的3封邮件...');
                    imap.search(['ALL'], (err, allResults) => {
                        if (err) {
                            console.error('❌ 搜索所有邮件失败:', err);
                            imap.end();
                            return;
                        }

                        if (allResults.length === 0) {
                            console.log('📭 收件箱中没有邮件');
                            imap.end();
                            return;
                        }

                        console.log(`📧 找到 ${allResults.length} 封邮件，获取最新的3封...`);
                        const recentResults = allResults.slice(-3);
                        fetchEmails(recentResults);
                    });
                } else {
                    console.log(`📧 找到 ${results.length} 封未读邮件`);
                    fetchEmails(results);
                }

                function fetchEmails(uidList) {
                    if (uidList.length === 0) {
                        imap.end();
                        return;
                    }

                    const uid = uidList[0];
                    console.log(`\n🔍 处理邮件 UID: ${uid}`);

                    // 获取邮件完整内容
                    imap.fetch([uid], {
                        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', 'TEXT'],
                        struct: true
                    }).on('message', (msg, seqno) => {
                        console.log(`📨 收到邮件 #${seqno}`);

                        msg.on('body', (stream, info) => {
                            let buffer = '';

                            stream.on('data', (chunk) => {
                                buffer += chunk.toString('utf8');
                            });

                            stream.once('end', () => {
                                console.log(`📧 邮件 #${seqno} ${info.which} 部分:`);
                                console.log(`原始数据长度: ${buffer.length}`);
                                console.log(`原始数据前200字符: "${buffer.substring(0, 200)}..."`);

                                if (info.which === 'HEADER') {
                                    console.log('\n📋 邮件头部解析:');
                                    const lines = buffer.split('\n');
                                    lines.forEach(line => {
                                        if (line.trim()) {
                                            if (line.toLowerCase().startsWith('subject:')) {
                                                console.log(`🎯 SUBJECT: "${line.trim()}"`);
                                            } else if (line.toLowerCase().startsWith('from:')) {
                                                console.log(`👤 FROM: "${line.trim()}"`);
                                            } else if (line.toLowerCase().startsWith('date:')) {
                                                console.log(`📅 DATE: "${line.trim()}"`);
                                            } else if (line.toLowerCase().startsWith('message-id:')) {
                                                console.log(`🆔 MESSAGE-ID: "${line.trim()}"`);
                                            }
                                        }
                                    });
                                } else if (info.which === 'TEXT') {
                                    console.log('\n📝 邮件正文内容:');
                                    console.log(`正文长度: ${buffer.length}`);
                                    console.log(`前500字符: "${buffer.substring(0, 500)}..."`);

                                    // 查找HTML标题标签
                                    const titleMatch = buffer.match(/<title[^>]*>([^<]+)<\/title>/i);
                                    if (titleMatch) {
                                        console.log(`🎨 HTML标题: "${titleMatch[1]}"`);
                                    }

                                    // 查找发件人信息
                                    const fromMatch = buffer.match(/sign in to ([^<]+)/i) || buffer.match(/from ([^<]+)/i);
                                    if (fromMatch) {
                                        console.log(`🏢 发件人信息: "${fromMatch[1]}"`);
                                    }

                                    // 查找验证码
                                    const codeMatches = buffer.match(/\b\d{4,8}\b/g);
                                    if (codeMatches) {
                                        console.log(`🔢 发现验证码: ${codeMatches.join(', ')}`);
                                    }
                                }
                            });
                        });

                        msg.once('attributes', (attrs) => {
                            console.log(`📊 邮件属性:`);
                            console.log(`  - UID: ${attrs.uid}`);
                            console.log(`  - Flags: ${attrs.flags.join(', ')}`);
                            console.log(`  - Date: ${attrs.date}`);
                            console.log(`  - Size: ${attrs.size}`);
                        });

                        msg.once('end', () => {
                            console.log(`✅ 邮件 #${seqno} 处理完成`);

                            // 处理下一封邮件
                            fetchEmails(uidList.slice(1));
                        });
                    });
                }
            });
        });
    });

    imap.once('error', (err) => {
        console.error('❌ IMAP连接错误:', err);
        process.exit(1);
    });

    imap.once('end', () => {
        console.log('🔚 IMAP连接结束');
        process.exit(0);
    });

    console.log('🔄 正在连接到Yahoo IMAP服务器...');
    imap.connect();
}

// 运行调试
debugYahooImap();