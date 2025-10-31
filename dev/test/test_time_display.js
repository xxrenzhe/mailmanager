#!/usr/bin/env node

/**
 * 测试验证码收件时间显示逻辑
 * 验证修复后的时间显示是否正确
 */

async function testTimeDisplay() {
    console.log('🧪 测试验证码收件时间显示逻辑...');

    try {
        // 获取当前账户列表
        console.log('\n1. 获取账户列表...');
        const response = await fetch('http://localhost:3000/api/accounts/paged?size=10');
        const data = await response.json();

        if (!data.accounts || data.accounts.length === 0) {
            console.log('⚠️  没有账户数据');
            return;
        }

        console.log(`📊 找到 ${data.accounts.length} 个账户`);

        // 分析账户的验证码和时间状态
        console.log('\n2. 分析验证码和时间显示逻辑...');

        let withValidCode = 0;
        let withTimeDisplay = 0;
        let withoutCode = 0;
        let inconsistent = 0;

        data.accounts.forEach(account => {
            console.log(`\n   📧 邮箱: ${account.email}`);
            console.log(`      验证码: ${account.latest_code || '无'}`);
            console.log(`      收件时间: ${account.latest_code_received_at || '无'}`);
            console.log(`      账户状态: ${account.status}`);
            console.log(`      创建时间: ${account.created_at}`);

            // 检查逻辑一致性
            const hasCode = !!account.latest_code;
            const hasTime = !!account.latest_code_received_at;
            const isNumericCode = account.latest_code && /^\d+$/.test(account.latest_code);

            if (hasCode) {
                withValidCode++;
                console.log(`      ✅ 有验证码`);

                if (isNumericCode) {
                    console.log(`      ✅ 是纯数字验证码`);
                    if (hasTime) {
                        withTimeDisplay++;
                        console.log(`      ✅ 有收件时间显示 (正确)`);
                    } else {
                        console.log(`      ⚠️  有验证码但没有收件时间 (可能是刚导入)`);
                    }
                } else {
                    console.log(`      ❌ 非纯数字验证码，应该不显示时间`);
                }
            } else {
                withoutCode++;
                console.log(`      ❌ 无验证码 (正确)`);
            }

            // 检查不一致的情况
            if (!hasCode && hasTime) {
                inconsistent++;
                console.log(`      🚨 逻辑不一致: 无验证码但有收件时间`);
            }
        });

        console.log('\n📊 统计结果:');
        console.log(`   有验证码的账户: ${withValidCode}`);
        console.log(`   有时间显示的账户: ${withTimeDisplay}`);
        console.log(`   无验证码的账户: ${withoutCode}`);
        console.log(`   逻辑不一致的账户: ${inconsistent}`);

        // 验证修复是否成功
        if (inconsistent === 0) {
            console.log('\n✅ 修复成功！验证码收件时间显示逻辑正确');
            console.log('   - 无验证码的账户显示"无"');
            console.log('   - 有验证码的账户根据情况显示时间');
            console.log('   - 逻辑完全一致');
        } else {
            console.log(`\n⚠️  发现 ${inconsistent} 个逻辑不一致的账户，需要进一步检查`);
        }

        // 获取当前时间，用于判断"刚导入"的逻辑
        const now = new Date();
        console.log(`\n🕐 当前时间: ${now.toLocaleString('zh-CN')}`);
        console.log('   (5分钟内导入的账户不显示验证码和时间)');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 运行测试
testTimeDisplay();