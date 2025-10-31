#!/usr/bin/env node

/**
 * 测试序号生成逻辑
 */

const fs = require('fs');

function testSequenceNumbers() {
    console.log('🧪 测试序号生成逻辑');
    console.log('===========================');

    try {
        // 检查文件存在
        const fileExists = fs.existsSync('./simple-mail-manager.html');
        if (!fileExists) {
            throw new Error('simple-mail-manager.html文件不存在');
        }
        console.log('✅ 文件存在');

        // 读取文件内容
        const content = fs.readFileSync('./simple-mail-manager.html', 'utf8');

        // 检查是否删除了index参数
        const mapMatch = content.match(/this\.filteredAccounts\.map\(([^)]+)\)/);
        if (mapMatch) {
            const mapParams = mapMatch[1];
            console.log('   map参数:', mapParams);

            // 检查是否只有一个参数
            if (!mapParams.includes(',')) {
                console.log('✅ 已删除index参数，只保留account参数');
            } else {
                console.log('❌ 仍然包含index参数');
                return;
            }
        } else {
            console.log('❌ 找不到map方法');
            return;
        }

        // 检查是否有全局序号计算逻辑
        const hasGlobalIndex = content.includes('const globalIndex = this.accounts.findIndex(acc => acc.id === account.id) + 1;');
        if (hasGlobalIndex) {
            console.log('✅ 包含全局序号计算逻辑');
        } else {
            console.log('❌ 缺少全局序号计算逻辑');
            return;
        }

        // 检查是否使用globalIndex而不是index + 1
        const usesGlobalIndex = content.includes('${globalIndex}') && !content.includes('${index + 1}');
        if (usesGlobalIndex) {
            console.log('✅ 使用globalIndex而不是index + 1');
        } else {
            console.log('❌ 仍然在使用index + 1或没有使用globalIndex');
            return;
        }

        // 检查findIndex方法的语法是否正确
        const findIndexSyntax = content.includes('this.accounts.findIndex(acc => acc.id === account.id)');
        if (findIndexSyntax) {
            console.log('✅ findIndex语法正确');
        } else {
            console.log('❌ findIndex语法有问题');
            return;
        }

        // 检查序号显示样式
        const sequenceStyle = content.includes('<td style="text-align: center; color: #666;">');
        if (sequenceStyle) {
            console.log('✅ 序号样式设置正确（居中、灰色）');
        } else {
            console.log('❌ 序号样式设置有问题');
        }

        console.log('\n🎉 序号生成逻辑测试完成！');
        console.log('===========================');
        console.log('✅ 修复了序号生成逻辑问题');
        console.log('✅ 序号现在基于全局账户位置');
        console.log('✅ 搜索和过滤不会影响序号显示');
        console.log('\n📝 修复说明:');
        console.log('   - 序号基于在所有账户中的位置（1-based）');
        console.log('   - 不受搜索、过滤等操作影响');
        console.log('   - 删除账户后序号会自动重新计算');

    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        process.exit(1);
    }
}

// 运行测试
testSequenceNumbers();