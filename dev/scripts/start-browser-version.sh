#!/bin/bash

# 邮件验证码管理系统 - 浏览器版启动脚本

echo "🚀 启动邮件验证码管理系统 (浏览器版)"
echo "================================"

# 检查文件是否存在
if [ ! -f "browser-version.html" ]; then
    echo "❌ 错误: 找不到 browser-version.html 文件"
    echo "请确保在正确的目录中运行此脚本"
    exit 1
fi

# 检查Python是否可用
if command -v python3 &> /dev/null; then
    echo "📂 使用Python启动本地服务器..."
    echo "🌐 访问地址: http://localhost:8000/browser-version.html"
    echo "⏹️  按 Ctrl+C 停止服务器"
    echo ""
    python3 -m http.server 8000
    exit 0
fi

# 检查Python2是否可用
if command -v python &> /dev/null; then
    echo "📂 使用Python2启动本地服务器..."
    echo "🌐 访问地址: http://localhost:8000/browser-version.html"
    echo "⏹️  按 Ctrl+C 停止服务器"
    echo ""
    python -m SimpleHTTPServer 8000
    exit 0
fi

# 检查Node.js是否可用
if command -v node &> /dev/null; then
    if command -v npx &> /dev/null; then
        echo "📂 使用Node.js启动本地服务器..."
        echo "🌐 访问地址: http://localhost:8000/browser-version.html"
        echo "⏹️  按 Ctrl+C 停止服务器"
        echo ""
        npx serve -s . -p 8000
        exit 0
    fi
fi

# 检查PHP是否可用
if command -v php &> /dev/null; then
    echo "📂 使用PHP启动本地服务器..."
    echo "🌐 访问地址: http://localhost:8000/browser-version.html"
    echo "⏹️  按 Ctrl+C 停止服务器"
    echo ""
    php -S localhost:8000
    exit 0
fi

# 如果没有可用的服务器，直接用浏览器打开
echo "⚠️  未找到可用的HTTP服务器"
echo "🌐 直接用浏览器打开文件..."

# 检测操作系统并打开浏览器
case "$(uname -s)" in
    Darwin*)    # macOS
        open browser-version.html
        ;;
    Linux*)     # Linux
        if command -v xdg-open &> /dev/null; then
            xdg-open browser-version.html
        elif command -v gnome-open &> /dev/null; then
            gnome-open browser-version.html
        else
            echo "❌ 无法自动打开浏览器，请手动打开 browser-version.html"
        fi
        ;;
    CYGWIN*|MINGW*|MSYS*) # Windows
        start browser-version.html
        ;;
    *)
        echo "��� 不支持的操作系统，请手动打开 browser-version.html"
        ;;
esac

echo "✅ 启动完成！"