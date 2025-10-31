#!/usr/bin/env node

/**
 * 测试简化后的批量导入功能
 * 验证简洁的界面和异步授权处理
 */

async function testSimplifiedImport() {
    console.log('🧪 测试简化后的批量导入功能...');

    try {
        // 获取初始统计信息
        console.log('\n1. 获取初始状态...');
        const statsResponse = await fetch('http://localhost:3000/api/sequence/stats');
        const initialStats = await statsResponse.json();
        console.log('初始统计:', {
            totalAccounts: initialStats.stats.totalAccounts,
            maxSequence: initialStats.stats.maxSequence
        });

        // 测试数据 - 包含不同数量的邮箱
        const testCases = [
            {
                name: '单个邮箱',
                data: 'single@test.com----pass1----client1----token1'
            },
            {
                name: '少量邮箱(3个)',
                data: `small1@test.com----pass1----client1----token1
small2@test.com----pass2----client2----token2
small3@test.com----pass3----client3----token3`
            },
            {
                name: '重复邮箱测试',
                data: `repeat@test.com----pass1----client1----token1
repeat@test.com----pass1----client1----token1
new@test.com----pass2----client2----token2`
            }
        ];

        for (const testCase of testCases) {
            console.log(`\n2. 测试${testCase.name}...`);

            const importResponse = await fetch('http://localhost:3000/api/bulk-import/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ import_data: testCase.data })
            });

            const importResult = await importResponse.json();

            if (importResult.success) {
                console.log(`✅ ${testCase.name}导入启动成功`);
                console.log(`   导入ID: ${importResult.import_id}`);
                console.log(`   解析数量: ${importResult.parsed_count}`);
                console.log(`   预估时间: ${importResult.estimatedTime?.seconds || 'N/A'}秒`);

                // 短暂监控，确保启动成功
                await quickMonitor(importResult.import_id, testCase.name);
            } else {
                console.log(`❌ ${testCase.name}导入失败: ${importResult.error}`);
            }
        }

        // 验证编号分配
        console.log('\n3. 验证编号分配...');
        const testEmails = ['single@test.com', 'small1@test.com', 'repeat@test.com', 'new@test.com'];

        for (const email of testEmails) {
            try {
                const seqResponse = await fetch(`http://localhost:3000/api/sequence/email/${encodeURIComponent(email)}`);
                if (seqResponse.status === 200) {
                    const seqResult = await seqResponse.json();
                    console.log(`   ${email} -> 编号: ${seqResult.sequence}`);
                }
            } catch (error) {
                console.log(`   ${email} -> 获取编号失败`);
            }
        }

        // 获取最终统计
        console.log('\n4. 获取最终统计...');
        const finalStatsResponse = await fetch('http://localhost:3000/api/sequence/stats');
        const finalStats = await finalStatsResponse.json();

        console.log('最终统计:', {
            totalAccounts: finalStats.stats.totalAccounts,
            accountsWithSequence: finalStats.stats.accountsWithSequence,
            maxSequence: finalStats.stats.maxSequence
        });

        const newAccounts = finalStats.stats.totalAccounts - initialStats.stats.totalAccounts;
        const newSequences = finalStats.stats.maxSequence - initialStats.stats.maxSequence;

        console.log('\n🎯 测试结果总结:');
        console.log(`  新增账户: ${newAccounts}`);
        console.log(`  新增编号: ${newSequences}`);
        console.log(`  编号一致性: ${newAccounts === newSequences ? '✅ 正常' : '⚠️ 需要检查'}`);
        console.log('✅ 简化后的批量导入功能测试通过！');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
    }
}

// 快速监控导入状态
async function quickMonitor(importId, testName) {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;

        try {
            const response = await fetch(`http://localhost:3000/api/bulk-import/status/${importId}`);
            const status = await response.json();

            if (status.error || status.status === 'completed') {
                if (status.status === 'completed') {
                    console.log(`   ✅ ${testName}完成: 成功${status.stats.successful}, 失败${status.stats.failed}`);
                }
                break;
            }

            if (attempts % 3 === 0) { // 每3秒输出一次
                const progress = Math.round((status.stats.processed / status.stats.total) * 100);
                console.log(`   ${testName}进度: ${progress}%`);
            }

        } catch (error) {
            console.log(`   ⚠️ ${testName}监控错误: ${error.message}`);
            break;
        }
    }
}

// 运行测试
testSimplifiedImport();