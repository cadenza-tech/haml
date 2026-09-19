import * as assert from 'node:assert';
import { applyCmdWrapper } from '../../hamlLint/cmdWrapper';

suite('hamlLint/cmdWrapper Test Suite', () => {
  test('should pass the command through untouched when no wrapper is needed', () => {
    const result = applyCmdWrapper('/usr/bin/haml-lint', ['--stdin', 'a.haml'], false);
    assert.strictEqual(result.command, '/usr/bin/haml-lint');
    assert.deepStrictEqual(result.args, ['--stdin', 'a.haml']);
    assert.strictEqual(result.windowsVerbatimArguments, false);
  });

  test('should route batch files through ComSpec', () => {
    const result = applyCmdWrapper('C:\\Ruby\\bin\\haml-lint.bat', ['--stdin', 'a.haml'], true, 'C:\\Windows\\system32\\cmd.exe');
    assert.strictEqual(result.command, 'C:\\Windows\\system32\\cmd.exe');
    assert.strictEqual(result.args[0], '/d');
    assert.strictEqual(result.args[1], '/s');
    assert.strictEqual(result.args[2], '/c');
    assert.ok(result.args[3]?.includes('haml-lint.bat'));
    assert.strictEqual(result.windowsVerbatimArguments, true);
  });

  // A bare `cmd.exe` would let CreateProcess search the current directory - the workspace - first,
  // which is the very hole resolving every command absolutely exists to close.
  test('should address cmd.exe absolutely when ComSpec is unset or empty', () => {
    assert.strictEqual(applyCmdWrapper('x.cmd', [], true).command, 'C:\\Windows\\System32\\cmd.exe');
    assert.strictEqual(applyCmdWrapper('x.cmd', [], true, undefined, 'D:\\Win').command, 'D:\\Win\\System32\\cmd.exe');
    assert.strictEqual(applyCmdWrapper('x.cmd', [], true, '').command, 'C:\\Windows\\System32\\cmd.exe');
  });

  // The command token is caret-escaped, not quoted, and cmd.exe reads an unquoted `/` as the start
  // of a switch: `C:/Ruby/bin/haml-lint.bat` would run `C:` - a drive change that exits 0 with an
  // empty stdout. Forward slashes are the natural spelling in settings.json, where a backslash needs
  // doubling, and cross-spawn normalizes the command at this same point for the same reason.
  test('should hand cmd.exe the command with native separators', () => {
    const result = applyCmdWrapper('C:/Ruby33/bin/haml-lint.bat', ['--stdin'], true, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepStrictEqual(result.args, ['/d', '/s', '/c', '"C:\\Ruby33\\bin\\haml-lint.bat ^^^"--stdin^^^""']);
  });

  test('should keep paths with spaces one token', () => {
    const result = applyCmdWrapper('C:\\Program Files\\Ruby\\haml-lint.bat', ['--stdin', 'C:\\My Docs\\a.haml'], true);
    assert.ok(result.args[3]?.includes('C:\\Program^ Files\\Ruby\\haml-lint.bat'));
    assert.ok(result.args[3]?.includes('^^^"C:\\My^^^ Docs\\a.haml^^^"'));
  });

  // cmd expands %NAME% even inside double quotes and no flag turns that off; the caret the escape
  // leaves between the percent signs is what keeps a defined variable's name from ever matching.
  test('should keep cmd from expanding %VAR% in an argument', () => {
    const result = applyCmdWrapper('C:\\r\\lint.bat', ['C:\\v\\sale%OS%.haml'], true, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepStrictEqual(result.args, ['/d', '/s', '/c', '"C:\\r\\lint.bat ^^^"C:\\v\\sale^^^%OS^^^%.haml^^^""']);
  });

  test('should escape embedded double quotes', () => {
    const result = applyCmdWrapper('a.cmd', ['say "hi"'], true, 'cmd');
    assert.strictEqual(result.args[3], '"a.cmd ^^^"say^^^ \\^^^"hi\\^^^"^^^""');
  });

  // A trailing backslash would otherwise fuse with the closing quote when the batch line is re-parsed.
  test('should double a trailing backslash', () => {
    const result = applyCmdWrapper('a.cmd', ['C:\\dir\\'], true, 'cmd');
    assert.strictEqual(result.args[3], '"a.cmd ^^^"C:\\dir\\\\^^^""');
  });
});
