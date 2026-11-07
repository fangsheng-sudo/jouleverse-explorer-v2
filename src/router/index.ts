import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'
import Blocks from '../views/Blocks.vue'
import BlockDetail from '../views/BlockDetail.vue'
import TransactionDetail from '../views/TransactionDetail.vue'
import AddressDetail from '../views/AddressDetail.vue'
import Home from '../views/Home.vue'
import JNSQuery from '../views/JNSQuery.vue'
import CoreCheckinStats from '../views/CoreCheckinStats.vue'
import ToolsHome from '../views/ToolsHome.vue'
import ContractToolView from '../views/ContractToolView.vue'
import MerkleProofGenerator from '../views/MerkleProofGenerator.vue'
import JNSVote from '../views/JNSVote.vue'
import JNSVoteProposalDetail from '../views/JNSVoteProposalDetail.vue'
import JnsDomains from '../views/JnsDomains.vue'

const routes = [
  { path: '/contracts', name: 'contractRegistry', component: () => import('../views/ContractRegistry.vue') },
  { path: '/validators', name: 'validators', component: () => import('../views/Validators.vue') },
  { path: '/tools/receipt', name: 'receiptVerifier', component: () => import('../views/ReceiptVerifier.vue') },
  { path: '/tools/integration', name: 'networkReadiness', component: () => import('../views/NetworkReadiness.vue') },
  {
    path: '/',
    name: 'home',
    component: Home
  },
  {
    path: '/core/checkin',
    name: 'coreCheckinStats',
    component: CoreCheckinStats
  },
  {
    path: '/tools',
    name: 'toolsHome',
    component: ToolsHome
  },
  {
    path: '/tools/contract/:key',
    name: 'contractTool',
    component: ContractToolView,
    props: true
  },
  {
    path: '/tools/analytics',
    name: 'analytics',
    component: () => import('../views/Analytics.vue')
  },
  {
    path: '/tools/multisig',
    name: 'multisig',
    component: () => import('../views/Multisig.vue')
  },
  {
    path: '/tools/merkle',
    name: 'merkleProofGenerator',
    component: MerkleProofGenerator
  },
  {
    path: '/jnsvote',
    name: 'jnsvote',
    component: JNSVote
  },
  {
    path: '/jnsvote/:id',
    name: 'jnsvoteProposalDetail',
    component: JNSVoteProposalDetail,
    props: (route: RouteLocationNormalized) => ({ proposalId: Number(route.params.id) })
  },
  {
    path: '/blocks',
    name: 'blocks',
    component: Blocks
  },
  {
    path: '/block/:number',
    name: 'blockDetail',
    component: BlockDetail,
    props: true
  },
  {
    path: '/tx/:hash',
    name: 'transactionDetail',
    component: TransactionDetail,
    props: true
  },
  {
    path: '/address/:address',
    name: 'addressDetail',
    component: AddressDetail,
    props: true
  },
  {
    path: '/jns',
    name: 'jnsQuery',
    component: JNSQuery
  },
  {
    path: '/domains',
    name: 'jnsDomains',
    component: JnsDomains
  },
  {
    path: '/jns/:name',
    name: 'jnsDetail',
    component: JNSQuery
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
