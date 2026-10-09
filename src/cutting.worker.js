import {optimizeCutting} from './cutting.js';
self.onmessage=({data})=>{try{self.postMessage({result:optimizeCutting(data)});}catch(error){self.postMessage({error:error.message});}};
