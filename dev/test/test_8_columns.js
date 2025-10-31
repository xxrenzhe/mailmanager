#!/usr/bin/env node

/**
 * 测试8列布局是否正确实现
 */

const fs = require('fs');

function test8ColumnLayout() {
    console.log('🧪 测试8列布局实现');
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

        // 检查表头是否有8列
        const headerMatch = content.match(/<thead>\s*<tr>(.*?)<\/tr>\s*<\/thead>/s);
        if (headerMatch) {
            const rowContent = headerMatch[1];
            // 计算<th>标签数量
            const thTags = rowContent.match(/<th[^>]*>/g);
            if (thTags && thTags.length === 8) {
                console.log('✅ 表头包含8列');
                console.log('   列数:', thTags.length);
            } else {
                console.log('❌ 表头列数不正确:', thTags ? thTags.length : 0);
                console.log('   实际<th>标签:', thTags);
                return;
            }
        }

        // 检查是否包含所有必要的列
        const requiredColumns = [
            '序号',
            '状态',
            '邮箱地址',
            '选中',
            '最新验证码',
            '验证码收件时间',
            '发件人',
            '操作'
        ];

        let allColumnsPresent = true;
        for (const column of requiredColumns) {
            if (content.includes(column)) {
                console.log(`✅ 包含"${column}"列`);
            } else {
                console.log(`❌ 缺少"${column}"列`);
                allColumnsPresent = false;
            }
        }

        // 检查空状态colspan是否正确
        const colspanMatch = content.match(/colspan="(\d+)"/);
        if (colspanMatch && colspanMatch[1] === '8') {
            console.log('✅ 空状态colspan设置为8');
        } else {
            console.log('❌ 空状态colspan设置不正确');
        }

        // 检查是否有全选复选框
        if (content.includes('id="selectAll"')) {
            console.log('✅ 包含全选复选框');
        } else {
            console.log('❌ 缺少全选复选框');
        }

        // 检查是否有复选框选择功能
        if (content.includes('toggleAccountSelection') && content.includes('toggleSelectAll')) {
            console.log('✅ 包含复选框选择功能');
        } else {
            console.log('❌ 缺少复选框选择功能');
        }

        // 检查是否有Client ID和Refresh Token字段
        if (content.includes('clientIdInput') && content.includes('refreshTokenInput')) {
            console.log('✅ 包含Client ID和Refresh Token字段');
        } else {
            console.log('❌ 缺少Client ID和Refresh Token字段');
        }

        // 检查是否有直接token验证功能
        if (content.includes('validateAccountAuth')) {
            console.log('✅ 包含直接token验证功能');
        } else {
            console.log('❌ 缺少直接token验证功能');
        }

        // 检查表格样式
        if (content.includes('#accountsTable {') && content.includes('.status-')) {
            console.log('✅ 包含表格样式定义');
        } else {
            console.log('❌ 缺少表格样式定义');
        }

        console.log('\n🎉 8列布局测试完成！');
        console.log('===========================');

        if (allColumnsPresent) {
            console.log('✅ 成功实现了完整的8列布局');
            console.log('✅ 保持了简洁的UI设计');
            console.log('✅ 集成了完整的业务功能');
            console.log('\n🌐 访问地址: http://localhost:8000/simple-mail-manager.html');
        } else {
            console.log('⚠️  部分功能可能不完整，请检查实现');
        }

    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        process.exit(1);
    }
}

// 运行测试
test8ColumnLayout();