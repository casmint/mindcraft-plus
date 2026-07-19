import { writeFile, readFile, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeCompartment, lockdown } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import {ESLint} from "eslint";
import settings from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_HISTORY_OUTPUT_CHARS = 480;

export function sanitizeGeneratedCode(code) {
    code = String(code || '').trim();
    code = code.replace(/^(?:javascript|js)\s*/i, '');
    code = code.replace(/catch\s*\([^)]*\)\s*\{\s*\}/g, "catch { log(bot, 'Generated action failed.'); }");

    const lines = [];
    let previousBlank = false;
    for (const rawLine of code.split('\n')) {
        let line = rawLine.trimEnd();
        const trimmed = line.trim();
        if (!trimmed) {
            if (!previousBlank) lines.push('');
            previousBlank = true;
            continue;
        }
        previousBlank = false;
        if (/^(?:await\s+|(?:const|let|var)\s+|return\s+|throw\s+|(?:skills|world|bot)\.)/.test(trimmed)
            && !/[;{}:,]$/.test(trimmed)) {
            line += ';';
        }
        lines.push(line);
    }
    return lines.join('\n').trim();
}

export function summarizeGeneratedCodeResult(code, output, succeeded = true) {
    const cleanCode = sanitizeGeneratedCode(code);
    const lineCount = cleanCode ? cleanCode.split('\n').length : 0;
    const compactOutput = String(output || 'No runtime output.')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_HISTORY_OUTPUT_CHARS) || 'No runtime output.';
    return 'Generated code: ' + lineCount + ' lines / ' + cleanCode.length + ' chars. Result: '
        + (succeeded ? 'success' : 'failure') + '. Runtime: ' + compactOutput;
}

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/'+agent.name+'/action-code/';
        this.code_template = '';
        this.code_lint_template = '';

        readFile(path.join(__dirname, '../../bots/execTemplate.js'), 'utf8', (err, data) => {
            if (err) throw err;
            this.code_template = data;
        });
        readFile(path.join(__dirname, '../../bots/lintTemplate.js'), 'utf8', (err, data) => {
            if (err) throw err;
            this.code_lint_template = data;
        });
        mkdirSync('.' + this.fp, { recursive: true });
    }

    async generateCode(agent_history) {
        this.agent.bot.modes.pause('unstuck');
        lockdown();
        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory(); 
        messages.push({role: 'system', content: 'Code generation started. Write code in codeblock in your response:'});

        const MAX_ATTEMPTS = 5;
        const MAX_NO_CODE = 3;

        let code = null;
        let no_code_failures = 0;
        for (let i=0; i<MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code)
                return null;
            const messages_copy = JSON.parse(JSON.stringify(messages));
            const codingResult = await this.agent.prompter.promptCoding(messages_copy);
            if (this.agent.bot.interrupt_code)
                return null;

            if (codingResult.status === 'busy') {
                return 'Code generation unavailable: coding request already in progress.';
            }
            if (codingResult.status === 'error') {
                return `Code generation failed: ${codingResult.message}`;
            }
            if (codingResult.status !== 'ok' || typeof codingResult.response !== 'string') {
                return 'Code generation failed: invalid coding response.';
            }

            let res = codingResult.response;
            let contains_code = res.indexOf('```') !== -1;
            if (!contains_code) {
                if (res.indexOf('!newAction') !== -1) {
                    messages.push({
                        role: 'assistant', 
                        content: res.substring(0, res.indexOf('!newAction'))
                    });
                    continue; // using newaction will continue the loop
                }
                
                if (no_code_failures >= MAX_NO_CODE) {
                    console.warn("Action failed, agent would not write code.");
                    return 'Action failed, agent would not write code.';
                }
                messages.push({
                    role: 'system', 
                    content: 'Error: no code provided. Write code in codeblock in your response. ``` // example ```'}
                );
                console.warn("No code block generated. Trying again.");
                no_code_failures++;
                continue;
            }
            code = this._sanitizeCode(res.substring(res.indexOf('```')+3, res.lastIndexOf('```')));
            const missingSkills = await this._missingGeneratedSkills(code);
            if (missingSkills.length > 0) {
                return `Generated code failed validation: nonexistent skill ${missingSkills[0]}`;
            }
            let result;
            try {
                result = await this._stageCode(code);
            } catch (error) {
                return `Generated code failed syntax check: ${error.message || String(error)}`;
            }
            if (!result?.func) {
                return 'Generated code failed validation: staging failed.';
            }
            const executionModule = result.func;
            const lintResult = await this._lintCode(result.src_lint_copy);
            if (lintResult) {
                const syntax = lintResult.match(/Message: (.*)/)?.[1] || lintResult;
                return `Generated code failed syntax check: ${syntax}`;
            }

            try {
                console.log('Executing code...');
                await executionModule.main(this.agent.bot);

                const code_output = this.agent.actions.getBotOutputSummary();
                return summarizeGeneratedCodeResult(code, code_output);
            } catch (e) {
                if (this.agent.bot.interrupt_code)
                    return null;
                
                console.warn('Generated code threw error: ' + e.toString());
                console.warn('trying again...');

                const code_output = this.agent.actions.getBotOutputSummary();

                messages.push({
                    role: 'assistant',
                    content: res
                });
                messages.push({
                    role: 'system',
                    content: `Code Output:\n${code_output}\nCODE EXECUTION THREW ERROR: ${e.toString()}\n Please try again:`
                });
            }
        }
        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }
    
    async  _lintCode(code) {
        let result = '#### CODE ERROR INFO ###\n';
        const codeNoComments = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const skillRegex = /((?:skills|world)\.(.*?))\(/g;
        const skills = [];
        let match;
        while ((match = skillRegex.exec(codeNoComments)) !== null) {
            skills.push(match[1]);
        }
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        const knownSkills = new Set(allDocs.map(doc => doc.split('\n')[0]));
        const missingSkills = skills.filter(skill => !knownSkills.has(skill));
        if (missingSkills.length > 0) {
            result += 'These functions do not exist:\n';
            result += missingSkills.join('\n');
            console.log(result)
            return result;
        }

        const eslint = new ESLint();
        const results = await eslint.lintText(code);
        const codeLines = code.split('\n');
        const exceptions = results.map(r => r.messages).flat();

        if (exceptions.length > 0) {
            exceptions.forEach((exc, index) => {
                if (exc.line && exc.column ) {
                    const errorLine = codeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                    result += `#ERROR ${index + 1}\n`;
                    result += `Message: ${exc.message}\n`;
                    result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                    result += `Related Code Line: ${errorLine}\n`;
                }
            });
            result += 'The code contains exceptions and cannot continue execution.';
        } else {
            return null;//no error
        }

        return result ;
    }

    async _missingGeneratedSkills(code) {
        const codeNoComments = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const calls = [...codeNoComments.matchAll(/\bskills\.([A-Za-z_$][\w$]*)\s*\(/g)]
            .map(match => `skills.${match[1]}`);
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        const known = new Set(allDocs.map(doc => doc.split('\n')[0]));
        return [...new Set(calls.filter(call => !known.has(call)))];
    }
    // write custom code to file and import it
    // write custom code to file and prepare for evaluation
    async _stageCode(code) {
        code = this._sanitizeCode(code);
        let src = '';
        code = code.replaceAll('console.log(', 'log(bot,');
        code = code.replaceAll('log("', 'log(bot,"');

        console.log(`Generated code staged: ${code.split('\n').length} lines / ${code.length} chars.`);
        if (settings.log_all_prompts) {
            console.debug(`Generated code (debug):\n${code}`);
        }

        // this may cause problems in callback functions
        code = code.replaceAll(';\n', '; if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}\n');
        for (let line of code.split('\n')) {
            src += `    ${line}\n`;
        }
        let src_lint_copy = this.code_lint_template.replace('/* CODE HERE */', src);
        src = this.code_template.replace('/* CODE HERE */', src);

        let filename = this.file_counter + '.js';
        // if (this.file_counter > 0) {
        //     let prev_filename = this.fp + (this.file_counter-1) + '.js';
        //     unlink(prev_filename, (err) => {
        //         console.log("deleted file " + prev_filename);
        //         if (err) console.error(err);
        //     });
        // } commented for now, useful to keep files for debugging
        this.file_counter++;
        
        let write_result = await this._writeFilePromise('.' + this.fp + filename, src);
        // This is where we determine the environment the agent's code should be exposed to.
        // It will only have access to these things, (in addition to basic javascript objects like Array, Object, etc.)
        // Note that the code may be able to modify the exposed objects.
        const compartment = makeCompartment({
            skills,
            log: skills.log,
            world,
            Vec3,
        });
        const mainFn = compartment.evaluate(src);
        
        if (write_result) {
            console.error('Error writing code execution file: ' + write_result);
            return null;
        }
        return { func:{main: mainFn}, src_lint_copy: src_lint_copy };
    }

    _sanitizeCode(code) {
        return sanitizeGeneratedCode(code);
    }

    _writeFilePromise(filename, src) {
        // makes it so we can await this function
        return new Promise((resolve, reject) => {
            writeFile(filename, src, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}
