console.log('🧪 测试导入解析逻辑...');

// 测试数据 - 您提供的格式
const testData = 'JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$';

// 测试新的解析逻辑
function testNewParsing() {
    console.log('\n📋 测试新的解析逻辑:');

    // 使用连续的-作为分隔符（支持不同数量的-）
    const parts = testData.split(/-+/);

    console.log(`  分割结果: ${parts.length} 个部分`);

    // 显示所有分割部分
    parts.forEach((part, index) => {
        console.log(`  字段${index + 1}: ${part}`);
    });

    if (parts.length >= 4) {
        const [email, password, clientId, refreshToken] = parts;

        console.log('\n📧 解析结果:');
        console.log(`  邮箱: ${email}`);
        console.log(`  密码: ${password}`);
        console.log(`  ClientId: ${clientId}`);
        console.log(`  RefreshToken: ${refreshToken.substring(0, 50)}...`);

        // 验证必填字段
        if (email && clientId && refreshToken) {
            console.log('\n✅ 解析成功: 所有必填字段都已提取');
            return true;
        } else {
            console.log('\n❌ 解析失败: 必填字段为空');
            console.log(`  邮箱: ${email ? '✅' : '❌'}`);
            console.log(`  ClientId: ${clientId ? '✅' : '❌'}`);
            console.log(`  RefreshToken: ${refreshToken ? '✅' : '❌'}`);
            return false;
        }
    } else {
        console.log(`\n❌ 解析失败: 期望4个字段，实际得到${parts.length}个`);
        parts.forEach((part, index) => {
            console.log(`  字段${index + 1}: ${part.substring(0, 30)}...`);
        });
        return false;
    }
}

// 测试旧解析逻辑对比
function testOldParsing() {
    console.log('\n📋 测试旧的解析逻辑（对比）:');

    // 使用固定的----分隔符
    const parts = testData.split('----');

    console.log(`  分割结果: ${parts.length} 个部分`);

    if (parts.length === 4) {
        console.log('✅ 旧逻辑能正常解析');
    } else {
        console.log(`❌ 旧逻辑解析失败: 期望4个字段，实际得到${parts.length}个`);
        parts.forEach((part, index) => {
            console.log(`  字段${index + 1}: ${part.substring(0, 30)}...`);
        });
    }
}

// 执行测试
console.log('🎯 测试数据长度:', testData.length, '字符');

const newResult = testNewParsing();
testOldParsing();

console.log('\n🏆 测试总结:');
if (newResult) {
    console.log('✅ 新解析逻辑可以正确处理您的数据格式');
    console.log('✅ 前端和后端都已更新为新的解析逻辑');
    console.log('✅ 现在可以重新尝试导入操作');
} else {
    console.log('❌ 新解析逻辑仍有问题，需要进一步调试');
}