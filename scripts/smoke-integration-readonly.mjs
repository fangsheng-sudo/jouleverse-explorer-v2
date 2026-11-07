#!/usr/bin/env node
// Node >=24，最多8个只读请求，不扫描、不发送交易。
import { createPublicClient, http } from 'viem'
import { writeFile } from 'node:fs/promises'
import { jouleverseChain } from '../src/config/chain.ts'
import { probeNetwork } from '../src/services/network-readiness.ts'
const profile={schema:'jouleverse.integration-profile/v1',chainId:jouleverseChain.id,name:jouleverseChain.name,rpcUrl:jouleverseChain.rpcUrls.default.http[0],explorerUrl:jouleverseChain.blockExplorers.default.url,nativeCurrency:{...jouleverseChain.nativeCurrency},multicall3:jouleverseChain.contracts.multicall3.address}
const args=process.argv.slice(2)
if(args.length && (args.length!==2 || args[0]!=='--save-fixture')){console.error('用法：node scripts/smoke-integration-readonly.mjs [--save-fixture <路径>]');process.exit(1)}
try{
 const responses=[];const client=createPublicClient({transport:http(profile.rpcUrl,{retryCount:0,timeout:10000})})
 const report=await probeNetwork(async request=>{try{const result=await client.request(request);responses.push({request,result});return result}catch(error){responses.push({request,error:error.message});throw error}},profile)
 console.log(JSON.stringify(report,null,2))
 if(args[1])await writeFile(args[1],JSON.stringify({profile,responses,observedAt:report.observedAt},null,2)+'\n')
 if(report.result==='blocked')process.exitCode=2
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1}
