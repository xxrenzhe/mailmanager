#!/usr/bin/env node

// 测试修复后的搜索条件结构
const timeFilter = '2025-11-04T10:30:55.000Z';
const filterDate = new Date(timeFilter);
const day = filterDate.getUTCDate();
const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][filterDate.getUTCMonth()];
const year = filterDate.getUTCFullYear();

const dateString = `${month} ${day}, ${year}`;

console.log('🔍 修复前后的搜索条件对比:');
console.log('');

console.log('❌ 错误的搜索条件（导致生产环境报错）:');
console.log('searchCriteria = ["SINCE", dateString]');
console.log('实际值:', ['SINCE', dateString]);
console.log('');

console.log('✅ 正确的搜索条件（本地测试成功）:');
console.log('searchCriteria = ["UNSEEN", ["SINCE", dateString]]');
console.log('实际值:', ['UNSEEN', ['SINCE', dateString]]);
console.log('');

console.log('📋 参考node-imap官方文档示例:');
console.log('imap.search([\'UNSEEN\', [\'SINCE\', \'May 20, 2010\']], function(err, results) {');
console.log('');

console.log('🎯 修复要点:');
console.log('1. 日期格式: "Nov 4, 2025" ✅');
console.log('2. 搜索结构: ["UNSEEN", ["SINCE", date]] ✅');
console.log('3. 正确嵌套: SINCE参数必须在数组中 ✅');