import { mount } from 'svelte'
import './styles/global.css'
import App from './app/App.svelte'

export default mount(App, { target: document.getElementById('app')! })
