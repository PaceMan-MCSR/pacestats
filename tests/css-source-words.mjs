import assert from 'node:assert/strict';
import {collectCssSourceWords} from '../scripts/css-source-words.mjs';

const words = collectCssSourceWords(`
    // card pagination modal should not keep unused Bootstrap components.
    const card = 1;
    const classes = {active: selected, 'btn-dark': true, disabled};
    const component = <nav className={\`navbar navbar-expand-sm \${dark ? 'bg-dark' : ''}\`}>
        <div className="container col-12"/>
        <button className={'btn ' + (selected ? 'btn-primary' : 'btn-dark')}/>
        <span className={\`d-\${size}-none text-center\`}/>
    </nav>;
`, 'fixture.tsx');
for (const word of ['navbar','navbar-expand-sm','bg-dark','container','col-12','btn',
    'btn-primary','btn-dark','active','disabled','text-center']) assert.ok(words.has(word),word);
for (const word of ['card','pagination','modal','nav','div','span','button']) assert.ok(!words.has(word),word);
assert.ok(collectCssSourceWords('const style = "table\\u0020table-dark";', 'fixture.ts').has('table-dark'));
console.log('CSS usage: literals/templates/conditional class maps retained; comments/variables/JSX tags excluded');
