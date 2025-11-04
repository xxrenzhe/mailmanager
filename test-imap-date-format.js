#!/usr/bin/env node

const { Imap } = require('imap');

// 测试正确的IMAP日期格式
const timeFilter = '2025-11-04T10:30:55.000Z';
const filterDate = new Date(timeFilter);
const day = filterDate.getUTCDate();
const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][filterDate.getUTCMonth()];
const year = filterDate.getUTCFullYear();

// 正确的IMAP日期格式：Month day, year
const dateString = `${month} ${day}, ${year}`;
console.log('🔍 测试IMAP日期格式:');
console.log('原始时间:', timeFilter);
console.log('UTC时间:', filterDate.toUTCString());
console.log('IMAP日期格式:', `"${dateString}"`);
console.log('搜索条件:', ['UNSEEN', ['SINCE', dateString]]);

// 模拟IMAP搜索验证（不实际连接）
console.log('\n✅ 这个格式应该不会导致"Incorrect number of arguments for search option: SINCE"错误');
console.log('📝 参考node-imap官方文档示例：["SINCE", "May 20, 2010"]');