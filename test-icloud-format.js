// 测试iCloud邮箱格式识别
const { parseImportLine } = require('./js/core/utils.js');

// 测试数据
const testLine = 'asakomarias2034@icloud.com----kqcd-bvef-upxy-iqzd';

console.log('🧪 测试iCloud邮箱格式识别...');
console.log('📧 测试数据:', testLine);

// 解析导入行
const result = parseImportLine(testLine);

console.log('\n📋 解析结果:');
console.log('✅ 解析成功:', !!result);

if (result) {
    console.log('\n📧 邮箱信息:');
    console.log(`  - 邮箱地址: ${result.email}`);
    console.log(`  - 邮箱类型: ${result.type}`);
    console.log(`  - 密码: ${result.password ? '已设置' : '未设置'}`);
    console.log(`  - Client ID: ${result.client_id || '无'}`);
    console.log(`  - Refresh Token: ${result.refresh_token || '无'}`);
    console.log(`  - 状态: ${result.status}`);

    console.log('\n🎯 验证结果:');
    console.log(`  - ✅ 邮箱类型正确: ${result.type === 'icloud' ? '是' : '否'}`);
    console.log(`  - ✅ 密码已提取: ${result.password ? '是' : '否'}`);
    console.log(`  - ✅ 无需OAuth: ${result.status === 'authorized' ? '是' : '否'}`);
    console.log(`  - ✅ 格式符合预期: ${result.password === 'kqcd-bvef-upxy-iqzd' ? '是' : '否'}`);
} else {
    console.log('❌ 解析失败');
}

console.log('\n📝 测试总结:');
console.log('iCloud邮箱格式: 邮箱地址----应用专用密码');
console.log('示例: asakomarias2034@icloud.com----kqcd-bvef-upxy-iqzd');
console.log('特点: 无需OAuth授权，直接使用IMAP连接');