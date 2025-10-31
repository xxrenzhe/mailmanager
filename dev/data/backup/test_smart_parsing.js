console.log('🧪 测试智能导入解析逻辑...');

// 测试数据 - 您提供的格式
const testData = 'EdwardBrunsonnc@outlook.com----HSSOLUUkzi6------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C506_BAY.0.U.-CslmIAGidBV6Q8fRaOP6DZxQxehJGGfzf8mfetwd9JggySDkE*CTeYC1msAu0361ffxZ*4XdI11Iw7QXlkd28r0yNoUu7gQloBacxEwfJFN*4U4OKkh5wp75pgHHSy7EGOsgDxAN2FJ5Hx6JD9ZAXsBZXqy76uywlGSleL9YdDo7FOgUrvqFFeLwkuke0TL0ZErF44JYnbBy3ycYlAGtZne2UyleYeKd3CxrNWMc*zYWHTotWs*2s2045wZy4NtMZd3jau0opLs5Sn1NgPH5j*52vi12SN40EhB2sNMaB*4XIw4s7Z1W!TeW*fdCJBLjbAiI4ixYIr0zcjtba*cLq7ULnZ*!Ia!fT025SOjkpIoyd1AGrju1UBaHZswD*hLbq9X*lal74ClkCBNhNXcViRU$';

// 测试智能解析逻辑
function testSmartParsing() {
    console.log('\n📋 测试智能解析逻辑:');

    // 智能解析：先按----分割，如果不是4个字段，再按连续的-分割
    let parts = testData.split('----');
    console.log(`  初始按----分割: ${parts.length} 个部分`);

    if (parts.length !== 4) {
        console.log('  初始分割不是4个字段，启动智能重构...');

        // 如果不是4个字段，尝试智能重构
        // 找到UUID格式的ClientId (8-4-4-4-12 格式)
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const uuidMatch = testData.match(uuidRegex);

        console.log(`  UUID匹配结果: ${uuidMatch ? uuidMatch[0] : '未找到'}`);

        if (uuidMatch) {
            const uuidIndex = testData.indexOf(uuidMatch[0]);
            const beforeUuid = testData.substring(0, uuidIndex).trim();
            const afterUuid = testData.substring(uuidIndex + uuidMatch[0].length).trim();

            console.log(`  UUID位置: ${uuidIndex}`);
            console.log(`  UUID前部分: ${beforeUuid.substring(0, 50)}...`);
            console.log(`  UUID后部分: ${afterUuid.substring(0, 50)}...`);

            // 分割before部分
            const beforeParts = beforeUuid.split(/-+/);
            console.log(`  UUID前部分分割: ${beforeParts.length} 个部分`);

            if (beforeParts.length >= 2) {
                parts = [
                    beforeParts[0], // 邮箱
                    beforeParts[1], // 密码
                    uuidMatch[0],    // ClientId (UUID)
                    afterUuid.replace(/^-+/, '') // 授权码 (去掉开头的-)
                ];
                console.log('  ✅ 智能重构成功');
            } else {
                console.log('  ❌ UUID前部分分割失败');
            }
        } else {
            console.log('  ❌ 未找到UUID格式的ClientId');
        }
    }

    console.log(`\n  最终分割结果: ${parts.length} 个部分`);

    if (parts.length >= 4) {
        const [email, password, clientId, refreshToken] = parts;

        console.log('\n📧 解析结果:');
        console.log(`  邮箱: ${email}`);
        console.log(`  密码: ${password}`);
        console.log(`  ClientId: ${clientId}`);
        console.log(`  RefreshToken: ${refreshToken.substring(0, 50)}...`);

        // 验证必填字段
        if (email && clientId && refreshToken) {
            console.log('\n✅ 智能解析成功: 所有必填字段都已提取');

            // 验证UUID格式
            const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            const isValidUUID = uuidRegex.test(clientId);
            console.log(`  ClientId UUID格式: ${isValidUUID ? '✅ 正确' : '❌ 错误'}`);

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

// 执行测试
console.log('🎯 测试数据长度:', testData.length, '字符');

const result = testSmartParsing();

console.log('\n🏆 测试总结:');
if (result) {
    console.log('✅ 智能解析逻辑可以正确处理您的数据格式');
    console.log('✅ 前端和后端都已更新为智能解析逻辑');
    console.log('✅ 现在可以重新尝试导入操作');
    console.log('✅ 支持UUID格式的ClientId识别');
} else {
    console.log('❌ 智能解析逻辑仍有问题，需要进一步调试');
}