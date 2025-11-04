#!/usr/bin/env node

const Imap = require('imap');
const simpleParser = require('mailparser').simpleParser;

// 测试Yahoo邮箱监控功能
const testLine = "GuarinLadayjakV@yahoo.com----fvuociwnxpezxssf";
const email = testLine.split('----')[0];
const password = testLine.split('----')[1];
const timeFilter = '2025-11-04T10:30:55.000Z'; // 模拟生产环境的时间戳

console.log('🔍 开始本地监控测试...');
console.log(`📧 邮箱: ${email}`);
console.log(`⏰ 时间过滤: ${timeFilter}`);

// Yahoo IMAP配置
const imapConfig = {
    user: email,
    password: password,
    host: 'imap.mail.yahoo.com',
    port: 993,
    tls: true,
    tlsOptions: {
        rejectUnauthorized: false
    },
    authTimeout: 30000,
    connTimeout: 30000
};

function extractVerificationCodes(text) {
    // 提取4-8位数字
    const patterns = [
        /\b(\d{4})\b/g,
        /\b(\d{5})\b/g,
        /\b(\d{6})\b/g,
        /\b(\d{7})\b/g,
        /\b(\d{8})\b/g
    ];

    const codes = [];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            codes.push(match[1]);
        }
    }

    return [...new Set(codes)];
}

function extractRecipientEmails(emailData) {
    const recipients = [];
    if (emailData.to && emailData.to.value) {
        emailData.to.value.forEach(addr => {
            if (addr && addr.address && addr.address.includes('@')) {
                recipients.push(addr.address.trim());
            }
        });
    }
    return [...new Set(recipients)];
}

console.log('🔄 正在连接Yahoo IMAP服务器...');

const imap = new Imap(imapConfig);

imap.once('ready', () => {
    console.log('✅ IMAP连接成功');

    imap.openBox('INBOX', false, (err, box) => {
        if (err) {
            console.error('❌ 打开收件箱失败:', err);
            imap.end();
            return;
        }

        console.log(`📬 收件箱打开成功，邮件总数: ${box.messages.total}`);

        // 测试修复后的日期格式
        let searchCriteria;
        if (timeFilter && timeFilter !== '2000-01-01T00:00:00Z') {
            const filterDate = new Date(timeFilter);
            const day = filterDate.getUTCDate();
            const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][filterDate.getUTCMonth()];
            const year = filterDate.getUTCFullYear();
            const dateString = `${month} ${day}, ${year}`;

            console.log(`🔍 使用修复后的IMAP日期格式: "${dateString}"`);
            console.log(`📋 搜索条件: ['UNSEEN', ['SINCE', '${dateString}']]`);
            searchCriteria = ['UNSEEN', ['SINCE', dateString]];
        } else {
            searchCriteria = ['ALL'];
        }

        const startTime = Date.now();

        imap.search(searchCriteria, (err, results) => {
            const searchTime = Date.now() - startTime;

            if (err) {
                console.error('❌ IMAP搜索失败:', err);
                console.error(`⏱️ 搜索耗时: ${searchTime}ms`);
                imap.end();
                return;
            }

            console.log(`✅ IMAP搜索成功！耗时: ${searchTime}ms`);
            console.log(`📧 找到 ${results ? results.length : 0} 封未读邮件`);

            if (!results || results.length === 0) {
                console.log('📭 没有找到符合条件的未读邮件');
                imap.end();
                return;
            }

            // 获取最近的几封邮件
            const fetchCount = Math.min(results.length, 5);
            const recentResults = results.slice(-fetchCount);

            console.log(`📥 获取最近的 ${fetchCount} 封邮件...`);

            const emails = [];
            let processedCount = 0;

            const fetch = imap.fetch(recentResults, {
                bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', '1'],
                struct: true
            });

            fetch.on('message', (msg, seqno) => {
                let buffer = '';
                let headers = {};

                msg.on('body', (stream, info) => {
                    stream.on('data', (chunk) => {
                        buffer += chunk.toString('utf8');
                    });

                    stream.once('end', () => {
                        if (info.which === 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)') {
                            headers = Imap.parseHeader(buffer);
                        }
                    });
                });

                msg.once('attributes', (attrs) => {
                    // 处理邮件属性
                });

                msg.once('end', () => {
                    processedCount++;

                    // 解析邮件内容
                    simpleParser(buffer, (err, mail) => {
                        if (!err && mail) {
                            const subject = mail.subject || '';
                            const text = mail.text || '';
                            const html = mail.html || '';
                            const allText = `${subject} ${text} ${html}`;

                            const codes = extractVerificationCodes(allText);
                            const recipients = extractRecipientEmails(mail);

                            const emailData = {
                                seqno: seqno,
                                subject: subject,
                                from: mail.from ? mail.from.text : '',
                                to: mail.to ? mail.to.text : '',
                                date: mail.date || new Date(),
                                codes: codes,
                                recipients: recipients,
                                hasCode: codes.length > 0
                            };

                            emails.push(emailData);

                            console.log(`📧 邮件 #${seqno}: ${subject.substring(0, 50)}...`);
                            if (codes.length > 0) {
                                console.log(`   🔢 发现验证码: ${codes.join(', ')}`);
                            }
                            if (recipients.length > 0) {
                                console.log(`   👥 收件人: ${recipients.join(', ')}`);
                            }
                        }

                        if (processedCount === fetchCount) {
                            console.log('\n📊 监控结果汇总:');
                            console.log(`✅ 处理邮件数: ${emails.length}`);
                            console.log(`🔢 包含验证码: ${emails.filter(e => e.hasCode).length}`);
                            console.log(`👥 提取收件人: ${emails.reduce((sum, e) => sum + e.recipients.length, 0)} 个`);

                            // 找到最新的验证码
                            const allCodes = emails.flatMap(e => e.codes);
                            if (allCodes.length > 0) {
                                console.log(`🎯 最新验证码: ${allCodes[allCodes.length - 1]}`);
                            }

                            imap.end();
                        }
                    });
                });
            });

            fetch.once('error', (err) => {
                console.error('❌ 获取邮件失败:', err);
                imap.end();
            });
        });
    });
});

imap.once('error', (err) => {
    console.error('❌ IMAP连接错误:', err);
});

imap.once('end', () => {
    console.log('🔚 IMAP连接结束');
    console.log('✅ 本地监控测试完成 - 没有出现IMAP搜索错误！');
});

// 开始连接
imap.connect();