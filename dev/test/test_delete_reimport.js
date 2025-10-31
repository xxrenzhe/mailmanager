#!/usr/bin/env node

/**
 * 测试删除邮箱后重新导入的编号分配
 * 验证删除后重新导入是否获得相同编号
 */

async function testDeleteReimport() {
    console.log('🧪 测试删除邮箱后重新导入的编号分配...');

    try {
        // 步骤1: 导入一个新邮箱
        console.log('\n1. 导入新邮箱 testdelete@example.com...');
        const testData = 'testdelete@example.com----password1----client1----token1';

        const importResponse = await fetch('http://localhost:3000/api/bulk-import/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ import_data: testData })
        });

        const importResult = await importResponse.json();

        if (importResult.success) {
            console.log('✅ 导入启动成功');
            await quickMonitor(importResult.import_id, '首次导入');
        } else {
            throw new Error('导入失败: ' + importResult.error);
        }

        // 步��2: 获取首次导入的编号
        console.log('\n2. 获取首次导入的编号...');
        const seqResponse = await fetch('http://localhost:3000/api/sequence/email/testdelete@example.com');
        const seqResult = await seqResponse.json();

        if (seqResult.success) {
            const originalSequence = seqResult.sequence;
            console.log(`   testdelete@example.com -> 编号: ${originalSequence}`);

            // 步骤3: 获取账户ID用于删除
            console.log('\n3. 查找账户ID...');
            const accountListResponse = await fetch('http://localhost:3000/api/accounts/paged?search=testdelete@example.com');
            const accountList = await accountListResponse.json();

            let accountId = null;
            if (accountList.accounts && accountList.accounts.length > 0) {
                accountId = accountList.accounts[0].id;
                console.log(`   找到账户ID: ${accountId}`);
            } else {
                throw new Error('未找到账户');
            }

            // 步骤4: 删除账户
            console.log('\n4. 删除账户...');
            const deleteResponse = await fetch(`http://localhost:3000/api/accounts/${accountId}`, {
                method: 'DELETE'
            });

            if (deleteResponse.ok) {
                console.log('✅ 账户删除成功');
            } else {
                throw new Error('删除失败');
            }

            // 等待一下确保删除完成
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 步骤5: 验证编号是否仍然存在
            console.log('\n5. 验证删除后编号是否仍然存在...');
            const seqAfterDeleteResponse = await fetch('http://localhost:3000/api/sequence/email/testdelete@example.com');
            const seqAfterDeleteResult = await seqAfterDeleteResponse.json();

            if (seqAfterDeleteResult.success) {
                console.log(`   删除后编号仍然存在: ${seqAfterDeleteResult.sequence}`);
            } else {
                console.log('   删除后编号不存在了');
            }

            // 步骤6: 重新导入相同邮箱
            console.log('\n6. 重新导入相同邮箱...');
            const reimportResponse = await fetch('http://localhost:3000/api/bulk-import/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ import_data: testData })
            });

            const reimportResult = await reimportResponse.json();

            if (reimportResult.success) {
                console.log('✅ 重新导入启动成功');
                await quickMonitor(reimportResult.import_id, '重新导入');
            } else {
                throw new Error('重新导入失败: ' + reimportResult.error);
            }

            // 步骤7: 验证重新导入的编号
            console.log('\n7. 验证重新导入的编号...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒确保处理完成

            const finalSeqResponse = await fetch('http://localhost:3000/api/sequence/email/testdelete@example.com');
            const finalSeqResult = await finalSeqResponse.json();

            if (finalSeqResult.success) {
                const finalSequence = finalSeqResult.sequence;
                console.log(`   重新导入后编号: ${finalSequence}`);

                // 步骤8: 对比结果
                console.log('\n8. 结果对比:');
                console.log(`   原始编号: ${originalSequence}`);
                console.log(`   重新导入编号: ${finalSequence}`);

                if (finalSequence === originalSequence) {
                    console.log('✅ 编号保持一致！');
                } else {
                    console.log('⚠️  编号不一致！');
                    console.log(`   说明: 删除后重新导入了新的编号，而不是复用原编号`);
                }

                // 获取当前最大编号
                const statsResponse = await fetch('http://localhost:3000/api/sequence/stats');
                const stats = await statsResponse.json();
                console.log(`   当前最大编号: ${stats.stats.maxSequence}`);

            } else {
                console.log('❌ 无法获取重新导入的编号');
            }

        } else {
            console.log('❌ 无法获取初始编号');
        }

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
                    console.log(`   ✅ ${testName}完成`);
                }
                break;
            }
        } catch (error) {
            console.log(`   ⚠️ ${testName}监控错误: ${error.message}`);
            break;
        }
    }
}

// 运行测试
testDeleteReimport();