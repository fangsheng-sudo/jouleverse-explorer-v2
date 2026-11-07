import { describe, it, expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { useWalletStore } from '../src/stores/wallet'
describe('钱包初始化',()=>{ it('初始化不应阻止页面渲染',()=>{const wrapper=mount(defineComponent({setup(){useWalletStore();return()=>h('div','ready')}}),{global:{plugins:[createPinia()]}}); expect(wrapper.text()).toBe('ready');wrapper.unmount()})})
