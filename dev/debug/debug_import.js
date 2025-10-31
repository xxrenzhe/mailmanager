// Debug script for import functionality
// Copy and paste this into the browser console to test the parsing

// Test data with correct format
const testData = `test.user@outlook.com----TestPass123!----c12b1a3d-4e56-7890-abcd-ef1234567890----M.C123_Wxyz.7890abcd-ef12-3456-789a-bcdef0123456`;

console.log('=== Testing Import Parse ===');

// Test parseImportLine function
function testParseLine() {
    console.log('1. Testing parseImportLine with sample data:');

    // This function should be available in the global scope from the main application
    if (typeof parseImportLine === 'function') {
        const result = parseImportLine(testData);
        console.log('Parse result:', result);

        if (result) {
            console.log('✅ Parsing successful');
            console.log('Email:', result.email);
            console.log('Has client_id:', !!result.client_id, 'Length:', result.client_id?.length);
            console.log('Has refresh_token:', !!result.refresh_token, 'Length:', result.refresh_token?.length);
        } else {
            console.log('❌ Parsing failed');
        }
    } else {
        console.log('❌ parseImportLine function not found. Make sure you run this on the main page.');
    }
}

// Test complete import flow
function testCompleteFlow() {
    console.log('2. Testing complete import flow:');

    if (typeof manager !== 'undefined' && typeof importEmails === 'function') {
        // Set the test data to the textarea
        const textarea = document.getElementById('importTextarea');
        if (textarea) {
            textarea.value = testData;
            console.log('✅ Test data inserted into textarea');

            // Check what will be parsed
            if (typeof parseImportData === 'function') {
                const parsedData = parseImportData(testData);
                console.log('Parsed data:', parsedData);
            }

        } else {
            console.log('❌ Import textarea not found');
        }
    } else {
        console.log('❌ manager or importEmails function not found');
    }
}

// Run tests
testParseLine();
testCompleteFlow();

console.log('=== Debug Instructions ===');
console.log('1. Open the main application (simple-mail-manager.html)');
console.log('2. Open browser developer console');
console.log('3. Copy and paste this script');
console.log('4. Check the console output');
console.log('5. Try importing with the sample data');