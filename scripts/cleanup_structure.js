#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🧹 开始清理冗余文件...');

// 定义要保留的文件
const keepFiles = new Set([
    'index.js',           // 主服务器文件
    'database_simple.js', // 当前使用的数据库
    'emailService.js',    // 邮件服务
    'simpleMonitor.js',   // 监控服务
    'cacheManager.js'     // 缓存管理
]);

// 定义要删除的冗余文件
const redundantFiles = [
    'database.js',
    'database_optimized.js',
    'database_simple_old.js',
    'index_kiss.js',
    'index_original.js',
    'loadBalancer.js',
    'onDemandMonitor.js',
    'scalableMonitor.js'
];

const serverDir = path.join(__dirname, '../server');

// 创建备份目录
const backupDir = path.join(__dirname, '../backup');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log('📁 创建备份目录:', backupDir);
}

// 移动冗余文件到备份目录
redundantFiles.forEach(file => {
    const sourcePath = path.join(serverDir, file);
    const backupPath = path.join(backupDir, file);

    if (fs.existsSync(sourcePath)) {
        try {
            fs.renameSync(sourcePath, backupPath);
            console.log(`✅ 已移动到备份: ${file} -> backup/${file}`);
        } catch (error) {
            console.error(`❌ 移动失败 ${file}:`, error.message);
        }
    } else {
        console.log(`⚠️  文件不存在: ${file}`);
    }
});

// 检查views目录中的冗余文件
const viewsDir = path.join(__dirname, '../views');
const viewFiles = fs.readdirSync(viewsDir);
const redundantViews = viewFiles.filter(file =>
    file.includes('_broken') || file.includes('_original') || file.includes('virtual_scroll')
);

redundantViews.forEach(file => {
    const sourcePath = path.join(viewsDir, file);
    const backupPath = path.join(backupDir, file);

    try {
        fs.renameSync(sourcePath, backupPath);
        console.log(`✅ 已移动视图到备份: ${file} -> backup/${file}`);
    } catch (error) {
        console.error(`❌ 移动视图失败 ${file}:`, error.message);
    }
});

// 清理测试文件（保留重要的几个）
const testFilesToBackup = [
    'test_parse.js',
    'test_parse2.js',
    'test_parse3.js',
    'test_active_time.js',
    'test_add_account.js',
    'test_delete_functionality.js',
    'test_direct_api.js',
    'test_display_logic.js',
    'test_existing_account.js',
    'test_import_parsing.js',
    'test_import_with_auth.js',
    'test_oauth_flow.js',
    'test_reactivate.js',
    'test_real_email.js',
    'test_smart_parsing.js',
    'test_william_account.js',
    'test_complete_functionality.js'
];

testFilesToBackup.forEach(file => {
    const sourcePath = path.join(__dirname, '../', file);
    const backupPath = path.join(backupDir, file);

    if (fs.existsSync(sourcePath)) {
        try {
            fs.renameSync(sourcePath, backupPath);
            console.log(`✅ 已移动测试文件到备份: ${file} -> backup/${file}`);
        } catch (error) {
            console.error(`❌ 移动测试文件失败 ${file}:`, error.message);
        }
    }
});

console.log('\n🎉 代码结构清理完成!');
console.log('📊 清理统计:');
console.log(`   - 移动服务文件: ${redundantFiles.length} 个`);
console.log(`   - 移动视图文件: ${redundantViews.length} 个`);
console.log(`   - 移动测试文件: ${testFilesToBackup.length} 个`);
console.log(`   - 备份位置: ${backupDir}`);
console.log('\n✨ 项目结构已优化，保留核心文件:');

// 显示当前干净的文件结构
console.log('\n📁 优化后的文件结构:');
console.log('   server/');
console.log('   ├── index.js (主服务器)');
console.log('   ├── database_simple.js (数据库)');
console.log('   ├── emailService.js (邮件服务)');
console.log('   ├── simpleMonitor.js (监控)');
console.log('   └── cacheManager.js (缓存)');
console.log('   views/');
console.log('   ├── accounts_simple.ejs (主界面)');
console.log('   └── import.ejs (导入页面)');
console.log('   data/ (数据存储)');
console.log('   scripts/ (部署脚本)');