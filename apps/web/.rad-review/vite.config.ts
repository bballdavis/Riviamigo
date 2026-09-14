import {defineConfig,mergeConfig} from 'vite';
import base from '../vite.config';
import {fileURLToPath} from 'node:url';
export default mergeConfig(base,defineConfig({resolve:{alias:[{find:'@riviamigo/hooks',replacement:fileURLToPath(new URL('./hooks.ts',import.meta.url))},{find:'@tanstack/react-router',replacement:fileURLToPath(new URL('./router.ts',import.meta.url))}]},server:{host:'127.0.0.1',port:5198,strictPort:true}}));
