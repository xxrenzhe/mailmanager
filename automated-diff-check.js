#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * 自动化差异检查脚本 - 确保simple-mail-manager.html和当前页面100%一致
 */

class AutomatedDiffChecker {
    constructor() {
        this.simpleMailManagerPath = path.join(__dirname, 'simple-mail-manager.html');
        this.indexHtmlPath = path.join(__dirname, 'index.html');
        this.globalFunctionsPath = path.join(__dirname, 'js/global-functions.js');
        this.utilsPath = path.join(__dirname, 'js/core/utils.js');
        this.simpleManagerPath = path.join(__dirname, 'js/core/SimpleMailManager.js');

        this.errors = [];
        this.warnings = [];
        this.missingElements = [];
    }

    // 读取文件内容
    readFile(filePath) {
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            this.errors.push(`无法读取文件: ${filePath} - ${error.message}`);
            return null;
        }
    }

    // 1. HTML结构差异检查
    checkHtmlStructure() {
        console.log('🔍 开始HTML结构差异检查...');

        const simpleContent = this.readFile(this.simpleMailManagerPath);
        const indexContent = this.readFile(this.indexHtmlPath);

        if (!simpleContent || !indexContent) return;

        // 提取HTML body内容
        const simpleBody = this.extractBodyContent(simpleContent);
        const indexBody = this.extractBodyContent(indexContent);

        // 检查关键HTML结构元素
        this.checkHtmlElements(simpleBody, indexBody);
        this.checkModals(simpleBody, indexBody);
        this.checkTableStructure(simpleBody, indexBody);
        this.checkButtons(simpleBody, indexBody);
        this.checkForms(simpleBody, indexBody);
    }

    extractBodyContent(html) {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? bodyMatch[1] : '';
    }

    checkHtmlElements(simple, index) {
        const elements = [
            'stats-row',
            'stat-item',
            'stat-number',
            'stat-label',
            'search-filter',
            'accountsTableBody',
            'pagination',
            'container mx-auto'
        ];

        elements.forEach(element => {
            if (simple.includes(element) && !index.includes(element)) {
                this.errors.push(`❌ 缺失HTML元素: ${element}`);
            } else if (!simple.includes(element) && index.includes(element)) {
                this.warnings.push(`⚠️ 多余HTML元素: ${element}`);
            }
        });
    }

    checkModals(simple, index) {
        const modals = ['importModal', 'importProgressModal', 'clearDataModal'];

        modals.forEach(modal => {
            const simpleModal = simple.includes(`id="${modal}"`);
            const indexModal = index.includes(`id="${modal}"`);

            if (simpleModal && !indexModal) {
                this.errors.push(`❌ 缺失模态框: ${modal}`);
            } else if (!simpleModal && indexModal) {
                this.warnings.push(`⚠️ 多余模态框: ${modal}`);
            }

            // 检查模态框属性
            if (simpleModal && indexModal) {
                this.checkModalAttributes(modal, simple, index);
            }
        });
    }

    checkModalAttributes(modal, simple, index) {
        const simpleModalMatch = simple.match(new RegExp(`<div[^>]*id="${modal}"[^>]*>`, 'g'));
        const indexModalMatch = index.match(new RegExp(`<div[^>]*id="${modal}"[^>]*>`, 'g'));

        if (simpleModalMatch && indexModalMatch) {
            const simpleAttrs = simpleModalMatch[0];
            const indexAttrs = indexModalMatch[0];

            // 检查z-index
            if (simple.includes('z-index: 1050') && !indexAttrs.includes('z-index: 1050')) {
                this.errors.push(`❌ ${modal} 缺失 z-index: 1050`);
            }

            // 检查flex类
            if (simple.includes('hidden flex items-center justify-center') && !indexAttrs.includes('hidden flex items-center justify-center')) {
                this.errors.push(`❌ ${modal} 缺失 flex布局类`);
            }
        }
    }

    checkTableStructure(simple, index) {
        // 检查表格结构
        const tableHeaders = ['序号', '状态', '邮箱地址', '选中', '最新验证码', '验证码时间', '发件人', '操作'];

        tableHeaders.forEach(header => {
            if (simple.includes(header) && !index.includes(header)) {
                this.errors.push(`❌ 缺失表格列: ${header}`);
            }
        });

        // 检查表格class属性
        const tableClasses = ['w-16', 'w-20', 'w-32', 'w-34', 'w-36', 'w-40', 'w-64', 'code-cell'];

        tableClasses.forEach(cls => {
            if (simple.includes(cls) && !index.includes(cls)) {
                this.errors.push(`❌ 缺失表格类: ${cls}`);
            }
        });
    }

    checkButtons(simple, index) {
        const buttons = [
            'showImportModal()',
            'refreshData()',
            'confirmClearAllData()',
            'hideImportModal()',
            'importEmails()',
            'copyEmailToClipboard',
            'manualFetchEmails',
            'deleteAccountConfirm',
            'copyLatestCode',
            'handleAccountSelection'
        ];

        buttons.forEach(button => {
            if (simple.includes(button) && !index.includes(button)) {
                this.errors.push(`❌ 缺失按钮功能: ${button}`);
            }
        });

        // 检查按钮样式类
        const buttonClasses = ['bg-blue-500', 'bg-green-500', 'bg-red-500', 'px-4', 'py-2', 'rounded-lg'];

        buttonClasses.forEach(cls => {
            const simpleCount = (simple.match(new RegExp(cls, 'g')) || []).length;
            const indexCount = (index.match(new RegExp(cls, 'g')) || []).length;

            if (simpleCount > indexCount) {
                this.errors.push(`❌ 按钮类 ${cls} 数量不匹配: simple=${simpleCount}, index=${indexCount}`);
            }
        });
    }

    checkForms(simple, index) {
        const formElements = ['searchInput', 'statusFilter', 'pageSize', 'importTextarea'];

        formElements.forEach(element => {
            if (simple.includes(element) && !index.includes(element)) {
                this.errors.push(`❌ 缺失表单元素: ${element}`);
            }
        });
    }

    // 2. JavaScript函数差异检查
    checkJavaScriptFunctions() {
        console.log('🔍 开始JavaScript函数差异检查...');

        const globalFunctions = this.readFile(this.globalFunctionsPath);
        const simpleHtml = this.readFile(this.simpleMailManagerPath);

        if (!globalFunctions || !simpleHtml) return;

        // 从simple-mail-manager.html提取所有函数定义
        const simpleFunctions = this.extractFunctions(simpleHtml);
        const globalFunctionDeclarations = this.extractFunctionDeclarations(globalFunctions);

        this.compareFunctions(simpleFunctions, globalFunctionDeclarations);
        this.checkFunctionSignatures(simpleFunctions, globalFunctions);
    }

    extractFunctions(html) {
        const functions = [];
        const functionMatches = html.match(/function\s+(\w+)\s*\([^)]*\)\s*\{/g);

        if (functionMatches) {
            functionMatches.forEach(match => {
                const funcNameMatch = match.match(/function\s+(\w+)/);
                if (funcNameMatch) {
                    functions.push(funcNameMatch[1]);
                }
            });
        }

        return functions;
    }

    extractFunctionDeclarations(js) {
        const functions = [];
        const functionMatches = js.match(/function\s+(\w+)\s*\([^)]*\)|^(\w+)\s*=>/gm);

        if (functionMatches) {
            functionMatches.forEach(match => {
                const funcName = match.trim().match(/^(\w+)/);
                if (funcName) {
                    functions.push(funcName[1]);
                }
            });
        }

        return [...new Set(functions)]; // 去重
    }

    compareFunctions(simpleFunctions, globalFunctions) {
        // 检查simple中是否有但global中缺失的函数
        simpleFunctions.forEach(func => {
            if (!globalFunctions.includes(func)) {
                // 检查是否在utils.js中
                const utilsContent = this.readFile(this.utilsPath);
                if (!utilsContent || !utilsContent.includes(`function ${func}`)) {
                    this.errors.push(`❌ 缺失JavaScript函数: ${func}()`);
                }
            }
        });

        // 检查global中是否有多余的函数
        globalFunctions.forEach(func => {
            if (!simpleFunctions.includes(func)) {
                this.warnings.push(`⚠️ 多余JavaScript函数: ${func}()`);
            }
        });
    }

    checkFunctionSignatures(simpleFunctions, globalFunctionsContent) {
        // 提取函数签名进行更详细的对比
        const simpleHtml = this.readFile(this.simpleMailManagerPath);
        simpleFunctions.forEach(func => {
            const simpleMatch = this.extractFunctionSignature(simpleHtml, func);
            const globalMatch = this.extractFunctionSignature(globalFunctionsContent, func);

            if (simpleMatch && globalMatch) {
                if (simpleMatch !== globalMatch) {
                    this.warnings.push(`⚠️ 函数签名不一致: ${func}()`);
                }
            }
        });
    }

    extractFunctionSignature(content, functionName) {
        const regex = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, 'g');
        const match = regex.exec(content);
        return match ? match[0] : null;
    }

    // 3. CSS样式差异检查
    checkCssStyles() {
        console.log('🔍 开始CSS样式差异检查...');

        const simpleHtml = this.readFile(this.simpleMailManagerPath);
        const cssFiles = [
            path.join(__dirname, 'css/complete-styles.css'),
            path.join(__dirname, 'css/components.css')
        ];

        if (!simpleHtml) return;

        // 提取simple-mail-manager.html中的内联CSS
        const inlineCss = this.extractInlineCss(simpleHtml);
        const externalCss = this.loadExternalCss(cssFiles);

        this.compareCssClasses(inlineCss, externalCss);
        this.checkCssProperties(inlineCss, externalCss);
    }

    extractInlineCss(html) {
        const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        return styleMatch ? styleMatch[1] : '';
    }

    loadExternalCss(cssFiles) {
        let cssContent = '';
        cssFiles.forEach(file => {
            const content = this.readFile(file);
            if (content) {
                cssContent += content + '\n';
            }
        });
        return cssContent;
    }

    compareCssClasses(inline, external) {
        const inlineClasses = this.extractCssClasses(inline);
        const externalClasses = this.extractCssClasses(external);

        inlineClasses.forEach(cls => {
            if (!external.includes(cls)) {
                this.errors.push(`❌ 缺失CSS类: .${cls}`);
            }
        });
    }

    extractCssClasses(css) {
        const classes = [];
        const regex = /\.([a-zA-Z][\w-]*)\s*{/g;
        let match;

        while ((match = regex.exec(css)) !== null) {
            classes.push(match[1]);
        }

        return [...new Set(classes)];
    }

    checkCssProperties(inline, external) {
        // 检查特定的CSS属性
        const criticalProperties = [
            'background: linear-gradient',
            'animation: pulse',
            '@keyframes',
            'transition: all'
        ];

        criticalProperties.forEach(prop => {
            if (inline.includes(prop) && !external.includes(prop)) {
                this.errors.push(`❌ 缺失CSS属性: ${prop}`);
            }
        });
    }

    // 4. 动态HTML模板检查
    checkDynamicTemplates() {
        console.log('🔍 开始动态HTML模板检查...');

        const simpleManagerPath = path.join(__dirname, 'js/core/SimpleMailManager.js');
        const simpleManagerContent = this.readFile(simpleManagerPath);

        if (!simpleManagerContent) return;

        // 提取render方法中的HTML模板
        const renderTemplate = this.extractRenderTemplate(simpleManagerContent);
        const simpleTemplate = this.extractRenderTemplate(this.simpleMailManagerPath);

        if (renderTemplate && simpleTemplate) {
            this.compareHtmlTemplates(renderTemplate, simpleTemplate);
        }
    }

    extractRenderTemplate(content) {
        const renderMatch = content.match(/render\(\)\s*\{[\s\S]*?tbody\.innerHTML\s*=.*?`[\s\S]*?`[\s\S]*?;/);
        return renderMatch ? renderMatch[0] : null;
    }

    compareHtmlTemplates(current, reference) {
        // 标准化HTML字符串进行比较
        const normalizedCurrent = this.normalizeHtml(current);
        const normalizedReference = this.normalizeHtml(reference);

        if (normalizedCurrent !== normalizedReference) {
            this.errors.push('❌ 动态HTML模板不一致');
            this.findTemplateDifferences(normalizedCurrent, normalizedReference);
        }
    }

    normalizeHtml(html) {
        return html
            .replace(/\s+/g, ' ')  // 标准化空白
            .replace(/>\s+</g, '><')  // 移除标签间空白
            .replace(/\s*([{}()[\]])\s*/g, '$1')  // 移除括号周围空白
            .trim();
    }

    findTemplateDifferences(current, reference) {
        // 找出具体的差异
        const lines1 = current.split('\n');
        const lines2 = reference.split('\n');

        const maxLines = Math.max(lines1.length, lines2.length);

        for (let i = 0; i < maxLines; i++) {
            if (lines1[i] !== lines2[i]) {
                this.errors.push(`❌ 模板差异在行 ${i + 1}:`);
                this.errors.push(`   当前: ${lines1[i]}`);
                this.errors.push(`   参考: ${lines2[i]}`);
            }
        }
    }

    // 5. 生成报告
    generateReport() {
        console.log('\n📊 自动化差异检查报告');
        console.log('='.repeat(50));

        if (this.errors.length === 0 && this.warnings.length === 0) {
            console.log('✅ 恭喜！没有发现任何差异，页面已完全迁移！');
            return true;
        }

        if (this.errors.length > 0) {
            console.log(`\n❌ 发现 ${this.errors.length} 个错误:`);
            this.errors.forEach((error, index) => {
                console.log(`${index + 1}. ${error}`);
            });
        }

        if (this.warnings.length > 0) {
            console.log(`\n⚠️  发现 ${this.warnings.length} 个警告:`);
            this.warnings.forEach((warning, index) => {
                console.log(`${index + 1}. ${warning}`);
            });
        }

        console.log(`\n📋 总结: ${this.errors.length} 个错误, ${this.warnings.length} 个警告`);
        return false;
    }

    // 运行所有检查
    runAllChecks() {
        console.log('🚀 开始自动化差异检查...\n');

        this.checkHtmlStructure();
        this.checkJavaScriptFunctions();
        this.checkCssStyles();
        this.checkDynamicTemplates();

        return this.generateReport();
    }
}

// 运行检查
const checker = new AutomatedDiffChecker();
const isPerfect = checker.runAllChecks();

process.exit(isPerfect ? 0 : 1);