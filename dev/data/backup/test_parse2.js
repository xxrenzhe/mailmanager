const importData = "JoelGrundydi@outlook.com----MOoyopg947------------------------------------------------------------9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$";

console.log('分析字符串结构...');

// 寻找所有的"----"位置
const separators = [];
let pos = 0;
while ((pos = importData.indexOf('----', pos)) !== -1) {
    separators.push(pos);
    pos += 4; // 跳过"----"本身
}

console.log('分隔符位置:', separators);
console.log('分隔符数量:', separators.length);

// 手动提取各部分
const email = importData.substring(0, separators[0]);
console.log('邮箱:', email);

// Client ID在第二和第三个分隔符之间
const clientIdStart = separators[1] + 4;
const clientIdEnd = separators[2];
const client_id = importData.substring(clientIdStart, clientIdEnd);
console.log('Client ID:', client_id);

// Refresh token在第三个分隔符之后
const refreshTokenStart = separators[2] + 4;
const refresh_token_enc = importData.substring(refreshTokenStart);
console.log('Refresh Token:', refresh_token_enc.substring(0, 100) + '...');
console.log('Refresh Token长度:', refresh_token_enc.length);

// 构建正确的导入对象
const importObject = {
    email: email.trim(),
    client_id: client_id.trim(),
    refresh_token_enc: refresh_token_enc.trim(),
    status: 'authorized'
};

console.log('\n构建的导入对象:');
console.log(JSON.stringify(importObject, null, 2));