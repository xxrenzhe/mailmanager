#!/usr/bin/env node

/**
 * 测试邮箱序列编号功能
 * 验证相同邮箱获得相同编号，编号按导入顺序递增
 */

async function testEmailSequence() {
    console.log('🧪 开始测试邮箱序列编号功能...');

    try {
        // 步骤1: 获取初始统计信息
        console.log('\n1. 获取初始序列统计信息...');
        const statsResponse = await fetch('http://localhost:3000/api/sequence/stats');
        const initialStats = await statsResponse.json();
        console.log('初始统计:', initialStats.stats);

        // 测试数据 - 包含重复邮箱
        const testData = [
            'alice@example.com----pass1----client1----token1',
            'bob@example.com----pass2----client2----token2',
            'alice@example.com----pass1----client1----token1', // 重复邮箱
            'charlie@example.com----pass3----client3----token3',
            'bob@example.com----pass2----client2----token2',   // 重复邮箱
            'david@example.com----pass4----client4----token4',
            'alice@example.com----pass1----client1----token1'  // 再次重复
        ].join('\n');

        // 步骤2: 第一次导入
        console.log('\n2. 第一次批量导入...');
        const import1Response = await fetch('http://localhost:3000/api/bulk-import/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_data: testData })
        });

        const import1Result = await import1Response.json();
        console.log('第一次导入结果:', import1Result);

        if (import1Result.success) {
            await monitorImportProgress(import1Result.import_id, '第一次导入');
        }

        // 步骤3: 验证编号分配
        console.log('\n3. 验证邮箱编号分配...');
        const testEmails = ['alice@example.com', 'bob@example.com', 'charlie@example.com', 'david@example.com'];
        const sequenceResults = {};

        for (const email of testEmails) {
            try {
                const seqResponse = await fetch(`http://localhost:3000/api/sequence/email/${encodeURIComponent(email)}`);
                const seqResult = await seqResponse.json();
                if (seqResult.success) {
                    sequenceResults[email] = seqResult.sequence;
                    console.log(`  ${email} -> 编号: ${seqResult.sequence}`);
                }
            } catch (error) {
                console.log(`  ${email} -> 获取编号失败: ${error.message}`);
            }
        }

        // 步骤4: 第二次导入（包含新邮箱和重复邮箱）
        console.log('\n4. 第二次批量导入（新邮箱 + 重复邮箱）...');
        const testData2 = [
            'eve@example.com----pass5----client5----token5',      // 新邮箱
            'alice@example.com----pass1----client1----token1',    // 重复邮箱
            'frank@example.com----pass6----client6----token6',    // 新邮箱
            'bob@example.com----pass2----client2----token2'       // 重复邮箱
        ].join('\n');

        const import2Response = await fetch('http://localhost:3000/api/bulk-import/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_data: testData2 })
        });

        const import2Result = await import2Response.json();
        console.log('第二次导入结果:', import2Result);

        if (import2Result.success) {
            await monitorImportProgress(import2Result.import_id, '第二次导入');
        }

        // 步骤5: 验证编号一致性
        console.log('\n5. 验证编号一致性...');
        let allConsistent = true;

        for (const [email, originalSequence] of Object.entries(sequenceResults)) {
            try {
                const seqResponse = await fetch(`http://localhost:3000/api/sequence/email/${encodeURIComponent(email)}`);
                const seqResult = await seqResponse.json();

                if (seqResult.success) {
                    if (seqResult.sequence === originalSequence) {
                        console.log(`✅ ${email}: 编号保持一致 (${originalSequence})`);
                    } else {
                        console.log(`❌ ${email}: 编号不一致! 原来: ${originalSequence}, 现在: ${seqResult.sequence}`);
                        allConsistent = false;
                    }
                }
            } catch (error) {
                console.log(`⚠️  ${email}: 验证失败 - ${error.message}`);
                allConsistent = false;
            }
        }

        // 步骤6: 验证新邮箱的编号
        console.log('\n6. 验证新邮箱编号...');
        const newEmails = ['eve@example.com', 'frank@example.com'];
        for (const email of newEmails) {
            try {
                const seqResponse = await fetch(`http://localhost:3000/api/sequence/email/${encodeURIComponent(email)}`);
                const seqResult = await seqResponse.json();

                if (seqResult.success) {
                    const isNewSequence = seqResult.sequence > Math.max(...Object.values(sequenceResults));
                    console.log(`${isNewSequence ? '✅' : '⚠️'} ${email}: 新编号 ${seqResult.sequence} ${isNewSequence ? '(大于旧编号)' : '(编号顺序问题)'}`);
                }
            } catch (error) {
                console.log(`❌ ${email}: 获取编号失败 - ${error.message}`);
            }
        }

        // 步骤7: 获取最终统计信息
        console.log('\n7. 获取最终统计信息...');
        const finalStatsResponse = await fetch('http://localhost:3000/api/sequence/stats');
        const finalStats = await finalStatsResponse.json();
        console.log('最终统计:', finalStats.stats);

        // 步骤8: 总结测试结果
        console.log('\n🎯 测试结果总结:');
        console.log(`  初始账户数: ${initialStats.stats.totalAccounts}`);
        console.log(`  最终账户数: ${finalStats.stats.totalAccounts}`);
        console.log(`  有编号账户数: ${finalStats.stats.accountsWithSequence}`);
        console.log(`  最大编号: ${finalStats.stats.maxSequence}`);
        console.log(`  编号一致性: ${allConsistent ? '✅ 通过' : '❌ 失败'}`);

        if (allConsistent) {
            console.log('\n🎉 邮箱序列编号功能测试通过！');
        } else {
            console.log('\n❌ 邮箱序列编号功能测试失败！');
        }

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 监控导入进度的辅助函数
async function monitorImportProgress(importId, testName) {
    console.log(`   监控 ${testName} 进度...`);

    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        try {
            const response = await fetch(`http://localhost:3000/api/bulk-import/status/${importId}`);
            const status = await response.json();

            if (status.error) {
                console.log(`   ❌ ${testName} 状态错误: ${status.error}`);
                break;
            }

            const stats = status.stats;
            const progress = Math.round((stats.processed / stats.total) * 100);

            if (i % 3 === 0) { // 每6秒输出一次进度
                console.log(`   ${testName} 进度: ${progress}% (${stats.processed}/${stats.total})`);
            }

            if (status.status === 'completed') {
                console.log(`   ✅ ${testName} 完成! 成功: ${stats.successful}, 失败: ${stats.failed}`);
                break;
            }

        } catch (error) {
            console.log(`   ⚠️  ${testName} 进度检查失败: ${error.message}`);
            break;
        }
    }
}

// 运行测试
testEmailSequence();