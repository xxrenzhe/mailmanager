#!/usr/bin/env node

/**
 * 邮箱信息解析测试脚本
 * 测试不同格式的邮箱信息是否能正确解析
 */

// 从simple-mail-manager.html中复制的解析逻辑
function parseEmailLine(line) {
    line = line.trim();
    if (!line) return null;

    let parts = line.split(/----+/);

    // 如果分割后的字段数不等于4，尝试智能解析
    if (parts.length !== 4) {
        console.log(`[Parse Debug] 第一次分割结果:`, parts);

        // 智能解析：查找UUID模式
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const uuidMatch = line.match(uuidRegex);
        console.log(`[Parse Debug] UUID匹配结果:`, uuidMatch);

        if (uuidMatch) {
            const uuidIndex = line.indexOf(uuidMatch[0]);
            const beforeUuid = line.substring(0, uuidIndex).trim();
            const afterUuid = line.substring(uuidIndex + uuidMatch[0].length).trim();
            const beforeParts = beforeUuid.split(/-+/);

            if (beforeParts.length >= 2) {
                parts = [
                    beforeParts[0],
                    beforeParts[1],
                    uuidMatch[0],
                    afterUuid.replace(/^-+/, '')
                ];
                console.log(`[Parse Debug] 智能重构结果:`, parts);
            }
        }
    }

    if (parts.length < 4) {
        console.warn(`[Parse] 无效数据格式，期望4个字段，实际${parts.length}个:`, line);
        console.warn(`[Parse] 字段详情:`, parts.map((p, i) => `字段${i+1}: "${p}"`));
        return null;
    }

    const [email, password, client_id, refresh_token_enc] = parts;

    // 验证每个字段
    if (!email || !email.includes('@')) {
        console.warn(`[Parse] 无效的邮箱地址: "${email}"`);
        return null;
    }

    if (!client_id || client_id.length < 10) {
        console.warn(`[Parse] 无效的client_id: "${client_id}"`);
        return null;
    }

    if (!refresh_token_enc || refresh_token_enc.length < 10) {
        console.warn(`[Parse] 无效的refresh_token: "${refresh_token_enc?.substring(0, 20)}..."`);
        return null;
    }

    const result = {
        email: email.trim(),
        password: password.trim(),
        client_id: client_id.trim(),
        refresh_token: refresh_token_enc.trim()
    };

    console.log(`[Parse Debug] 最终解析结果:`, {
        email: result.email,
        hasClientId: !!result.client_id,
        clientIdLength: result.client_id.length,
        hasRefreshToken: !!result.refresh_token,
        refreshTokenLength: result.refresh_token.length
    });

    return result;
}

// 测试用例
const testCases = [
    {
        name: "格式1：第2个分隔符有多个'-'（用户提到的原始格式）",
        input: "RuthMoorekx@outlook.com----Ofzmbis1------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C552_BAY.0.U.-Cg1AvNkQOKRWWkdxOkQq!!HlQamoacgw3a*d25kPBSBatxb26406phBl!PzqIsXvudBOKZ2!wfweyMmmcEr8WBpuN*w4ZxJj5bjdOhPCwzBQOWhpaBEewJgl3uADdidXnz8ZhaGQ5RXxK!w07zsUoZaMJbBKrwCZa0VE7y0wJ0*qW!YbaAYcSYLe0abtOE*EXkECVu!0O7pUXZHcPRwbQ9lOjU*AnQhsikjVNdxtdnEULRcFQCx7zGqL0!5!O2ryNyiJK4cYp248l71z7eudbleGtuAOF7XPSefzY2Tney6twKJjxTCbgU0548r4vzz1!213wxvoE4hxaiENcEnQ2T4GFVepkU7EDz0FKi5CDygNjVSbGYuvyfXANYDqtkrIgg$$"
    },
    {
        name: "格式2：第2个分隔符只有少数'-'（用户提到的新格式）",
        input: "RuthMoorekx@outlook.com----Ofzmbis1----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C552_BAY.0.U.-Cg1AvNkQOKRWWkdxOkQq!!HlQamoacgw3a*d25kPBSBatxb26406phBl!PzqIsXvudBOKZ2!wfweyMmmcEr8WBpuN*w4ZxJj5bjdOhPCwzBQOWhpaBEewJgl3uADdidXnz8ZhaGQ5RXxK!w07zsUoZaMJbBKrwCZa0VE7y0wJ0*qW!YbaAYcSYLe0abtOE*EXkECVu!0O7pUXZHcPRwbQ9lOjU*AnQhsikjVNdxtdnEULRcFQCx7zGqL0!5!O2ryNyiJK4cYp248l71z7eudbleGtuAOF7XPSefzY2Tney6twKJjxTCbgU0548r4vzz1!213wxvoE4hxaiENcEnQ2T4GFVepkU7EDz0FKi5CDygNjVSbGYuvyfXANYDqtkrIgg$$"
    },
    {
        name: "格式3：标准4字段格式",
        input: "test@example.com----password----9e5f94bc-e8a4-4e73-b8be-63364c29d753----refresh_token_here"
    },
    {
        name: "格式4：没有UUID的格式",
        input: "test@example.com----password----client_id----refresh_token_here"
    },
    {
        name: "格式5：第2个字段包含多个'-'但没有UUID",
        input: "test@example.com----pass-word-test----client_id----refresh_token_here"
    }
];

// 执行测试
console.log('🧪 开始邮箱信息解析测试');
console.log('=' .repeat(80));

testCases.forEach((testCase, index) => {
    console.log(`\n${index + 1}. 测试: ${testCase.name}`);
    console.log(`输入: ${testCase.input.substring(0, 100)}${testCase.input.length > 100 ? '...' : ''}`);

    try {
        const result = parseEmailLine(testCase.input);
        if (result) {
            console.log('✅ 解析成功');
            console.log(`   邮箱: ${result.email}`);
            console.log(`   Client ID: ${result.client_id.substring(0, 20)}...`);
            console.log(`   Refresh Token: ${result.refresh_token.substring(0, 30)}...`);
        } else {
            console.log('❌ 解析失败');
        }
    } catch (error) {
        console.log('❌ 解析异常:', error.message);
    }

    console.log('-'.repeat(60));
});

// 专门测试用户关心的两种格式
console.log('\n🎯 重点测试：用户关心的两种格式对比');
console.log('=' .repeat(80));

const userFormats = [
    {
        name: "原始格式（第2个分隔符有多个'-'）",
        input: testCases[0].input
    },
    {
        name: "新格式（第2个分隔符只有少数'-'）",
        input: testCases[1].input
    }
];

userFormats.forEach((format, index) => {
    console.log(`\n${index + 1}. ${format.name}`);
    console.log(`输入: ${format.input.substring(0, 120)}...`);

    const result = parseEmailLine(format.input);

    if (result) {
        console.log('✅ 解析成功');
        console.log(`   邮箱: ${result.email}`);
        console.log(`   Client ID有效性: ${result.client_id.length > 10 ? '✅' : '❌'} (${result.client_id.length} 字符)`);
        console.log(`   Refresh Token有效性: ${result.refresh_token.length > 10 ? '✅' : '❌'} (${result.refresh_token.length} 字符)`);
    } else {
        console.log('❌ 解析失败');
    }
});

console.log('\n📊 测试完成');