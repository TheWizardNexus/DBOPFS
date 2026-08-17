import VanillaTest from '/node_modules/vanilla-test/index.js';

export const SUITE_NAMES=Object.freeze([
    'Unit',
    'Functional',
    'Integration',
    'Regression'
]);

export function serializeError(error){
    return {
        code:error?.code||null,
        message:error?.message||String(error),
        name:error?.name||'Error',
        stack:error?.stack||null
    };
}

export function assert(condition,message='Assertion failed.'){
    if(!condition){
        throw new Error(message);
    }
}

export function assertEqual(actual,expected,message='Values are not equal.'){
    if(!Object.is(actual,expected)){
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function canonicalValue(value){
    if(Array.isArray(value)){
        return value.map(canonicalValue);
    }
    if(value&&typeof value==='object'){
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key=>[key,canonicalValue(value[key])])
        );
    }
    return value;
}

export function assertDeepEqual(actual,expected,message='Values are not deeply equal.'){
    const actualJSON=JSON.stringify(canonicalValue(actual));
    const expectedJSON=JSON.stringify(canonicalValue(expected));

    if(actualJSON!==expectedJSON){
        throw new Error(`${message}\nExpected: ${expectedJSON}\nActual: ${actualJSON}`);
    }
}

export async function expectError(operation,{code=null,name=null}={}){
    let caught=null;

    try{
        await operation();
    }catch(error){
        caught=error;
    }

    assert(caught,'Expected the operation to reject.');
    if(code!==null){
        assertEqual(caught.code,code,'The rejection used the wrong error code.');
    }
    if(name!==null){
        assertEqual(caught.name,name,'The rejection used the wrong error name.');
    }
    return caught;
}

export function withTimeout(promise,timeout,message){
    return new Promise((resolve,reject)=>{
        const timer=setTimeout(
            ()=>reject(new Error(`${message} (${timeout}ms).`)),
            timeout
        );

        Promise.resolve(promise).then(
            value=>{
                clearTimeout(timer);
                resolve(value);
            },
            error=>{
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

export async function waitFor(predicate,timeout,message){
    const deadline=performance.now()+timeout;

    while(performance.now()<deadline){
        if(predicate()){
            return;
        }
        await new Promise(resolve=>setTimeout(resolve,25));
    }

    throw new Error(`${message} (${timeout}ms).`);
}

function validateSuites(suites){
    assert(Array.isArray(suites),'The browser test registry requires an array of suites.');
    assertEqual(suites.length,SUITE_NAMES.length,'Exactly four browser test suites are required.');

    const ids=new Set();
    const descriptions=new Set();

    suites.forEach((suite,index)=>{
        assertEqual(
            suite?.name,
            SUITE_NAMES[index],
            'Suites must run in Unit, Functional, Integration, Regression order.'
        );
        assert(Array.isArray(suite.cases)&&suite.cases.length>0,
            `${suite.name} must declare at least one test case.`);

        for(const testCase of suite.cases){
            assert(typeof testCase.id==='string'&&testCase.id.length>0,
                `${suite.name} contains a test without a stable ID.`);
            assert(typeof testCase.description==='string'&&testCase.description.length>0,
                `${testCase.id} has no test description.`);
            assert(typeof testCase.run==='function',`${testCase.id} has no test operation.`);
            assert(!ids.has(testCase.id),`Duplicate test ID: ${testCase.id}.`);
            assert(!descriptions.has(testCase.description),
                `Duplicate test description: ${testCase.description}.`);
            ids.add(testCase.id);
            descriptions.add(testCase.description);
        }
    });
}

function suiteSummary(details,name){
    const suiteCases=details.filter(testCase=>testCase.suite===name);
    return {
        failed:suiteCases.filter(testCase=>testCase.status==='failed').length,
        name,
        passed:suiteCases.filter(testCase=>testCase.status==='passed').length,
        skipped:suiteCases.filter(testCase=>testCase.status==='skipped').length,
        total:suiteCases.length
    };
}

export function createTestRegistry({frameworkVersion='1.4.9'}={}){
    const framework=new VanillaTest();
    const details=[];
    let hasRun=false;

    async function runCase(suite,testCase,context){
        const started=performance.now();
        const descriptor=`[${suite.name}] ${testCase.description}`;
        let error=null;
        let status='passed';
        framework.expects(descriptor);

        try{
            const skip=typeof testCase.skip==='function'
                ?await testCase.skip(context)
                :Boolean(testCase.skip);
            if(skip){
                status='skipped';
            }else{
                await testCase.run(context);
            }
        }catch(caught){
            error=serializeError(caught);
            status='failed';
        }

        if(status==='failed'){
            framework.fail();
        }else{
            framework.pass();
        }
        framework.done();

        details.push({
            description:testCase.description,
            durationMs:Number((performance.now()-started).toFixed(3)),
            error,
            id:testCase.id,
            reason:status==='skipped'
                ?testCase.reason||'This browser does not expose the required API.'
                :null,
            status,
            suite:suite.name
        });
    }

    async function run(suites,context={}){
        assert(!hasRun,'A browser test registry can only run once.');
        hasRun=true;
        validateSuites(suites);

        for(const suite of suites){
            for(const testCase of suite.cases){
                await runCase(suite,testCase,context);
            }
        }

        const frameworkResults=framework.report(false);
        const suiteResults=SUITE_NAMES.map(name=>suiteSummary(details,name));
        const summary={
            failed:details.filter(testCase=>testCase.status==='failed').length,
            passed:details.filter(testCase=>testCase.status==='passed').length,
            skipped:details.filter(testCase=>testCase.status==='skipped').length,
            total:details.length
        };

        return {
            cases:details,
            framework:{
                name:'vanilla-test',
                results:frameworkResults,
                version:frameworkVersion
            },
            suites:suiteResults,
            summary
        };
    }

    return {run};
}
