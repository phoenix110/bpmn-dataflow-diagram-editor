// main dependecny 引入相关的依赖
import BpmnModeler from 'bpmn-js/lib/Modeler'
// Cli tools 控制台工具
import CliModule from 'bpmn-js-cli'
// customization 自定义模块
import CustomModule from './module'

import store from './model/store'
import { operatorList } from './mock'

// TODO: add diagram debug helper

const ignoreList = [
  'bpmn:Process',
  'bpmn:SequenceFlow',
  'label',
  'bpmn:StartEvent',
  'bpmn:EndEvent',
]
const processName = 'Process_1'
const StartEventName = 'StartEvent_1'
// const EndEventName = 'EndEvent_1'

// evaluateNodeInput from parents' nodeOutput according to config.input & then updateTransfer
function evaluateNodeInput(node) {

  let operatorId = getAttrs(node).ID
  let config = operatorList.find(
    item => String(item.id) === String(operatorId)
  )
  if(config.input) {
    let parentNodes = getParentNodes(node)
    // console.log('parentNodes:', parentNodes)
    let parentOutputs = parentNodes.map(node => store.state.outputModel[node.id]).filter(item => item !== {} && item !== undefined)
    // console.log('parentOuputs:', parentOutputs)
    // config.input is an array of object, pick sepcific key arrays as nodeInput, and flatmap if needed
    // Example: input:[{key: ['c7-1','c7-2'], target: 'c7',mode: 'flatMap'}] means pick 'c7-1','c7-2', flatten result into c7
    // flatMap
    let resultObject = config.input.reduce((result, inputEntry) => {
      let currentObj
      if(inputEntry.key && inputEntry.target) {
        let keys = inputEntry.key
        if(typeof keys === 'string'){
          keys = [keys]
        }
        currentObj = parentOutputs.flatMap(output => keys.flatMap(key => output[key] ? output[key] : []))
        return Object.assign(result, {[inputEntry.target] : currentObj})
      }
    }, {})
    // if input Change commit to the vuex
    if(resultObject && diff(resultObject, store.state.inputModel[node.id])) {
      // console.log('nodeInput', resultObject)
      store.commit('setInput', {id: node.id, obj: resultObject})
      store.commit('updateTransfer', {id: node.id})
    }
  }
}
// evaluateNodeOuput from nodeTransfer according to config.output
function evaluateNodeOutput(node){

  let operatorId = getAttrs(node).ID
  let property = store.state.transferModel[node.id]

  let config = operatorList.find(
    item => String(item.id) === String(operatorId)
  )
  if(config.output) {
    // config.output is an array of object, pick specific keys to nodeOutput, and maybe do a rename
    // Example: [{key:'option3',rename:'c7' }] means pick 'option3', and rename it to c7.
    // reduce
    //  note this will override entry with same keys, so keep diffrent output keys by using rename
    let resultObject = config.output.reduce((result, outputEntry) => {
      let currentObj
      if(outputEntry.key && property[outputEntry.key]) {
        let outKey = outputEntry.rename ? outputEntry.rename : outputEntry.key
        currentObj = {[outKey]: property[outputEntry.key]}
      }
      return Object.assign(result, currentObj)
    }, {})

    // if output Change commit to the vuex
    if(resultObject && diff(resultObject, store.state.outputModel[node.id])) {
      // console.log('nodeOutput', resultObject)
      store.commit('setOutput', {id: node.id, obj: resultObject})
    }
  }
}
// Promise helper for bfs
Promise.each = async function(arr, fn) { // take an array and a function
  for(const item of arr) await fn(item);
}
// bfs eval nodes asynchronously
function evaluateNodeData(nodesToVisit, type = ''){
  // TODO: use DFS check if there is a loop in the diagram before continue
  if(nodesToVisit.length === undefined && nodesToVisit.id) {
    nodesToVisit = [nodesToVisit]
  }
  let nodesBatch = nodesToVisit;
  nodesToVisit = [];
  Promise.each(nodesBatch, node => {
      console.log(node.id, node.name, type);
      if (ignoreList.indexOf(node.$type) === -1) {
        evaluateNodeInput(node.id)
        evaluateNodeOutput(node.id)
      }
      let childNodes = getChildNodes(node)
      nodesToVisit = nodesToVisit.concat(childNodes)
  }).then(function() {
    if(nodesToVisit.length > 0) {
      evaluateNodeData(nodesToVisit, "bfs")
    }
  })
}
export default class Diagram {

  constructor(container) {
    this.bpmnModeler = new BpmnModeler({
      container: container,
      // load custom module
      additionalModules: [CliModule, CustomModule],
      cli: {
        bindTo: 'cli',
      },
      bpmnRenderer: {
        defaultFillColor: '#fff',
        defaultStrokeColor: '#6CB139',
      },
    })
    this.modeling = this.bpmnModeler.get('modeling')
    this.canvas = this.bpmnModeler.get('canvas')
    this.overlays = this.bpmnModeler.get('overlays')
    this.eventBus = this.bpmnModeler.get('eventBus')
    this.interactionEvents = this.bpmnModeler.get('interactionEvents')
    this.commandStack = this.bpmnModeler.get('commandStack')
    this.selection = this.bpmnModeler.get('selection')
    this.zoomScroll = this.bpmnModeler.get('zoomScroll')
    // disable mouse wheel scroll but keep zoom
    // eslint-disable-next-line
    this.zoomScroll.__proto__.scroll = () => {}
    this.cli = window.cli
    const registerEvents = () => {
      // click event: fire vuex mutation 'selectNode' with clicked node id
      this.eventBus.on('element.click', 0, event => {
        let el = event.element
        if (ignoreList.indexOf(el.type) === -1) {
          // make sure not mutiple elements selected
          let els = this.selection.get()
          if(store.state.currentNodeId !== el.businessObject.id && els.length === 1) {
            store.commit('selectNode', el.businessObject)
          }
          return true
        }
        else {
          // return false will cancel event
          return false
        }
      })
      // connection event: fire vuex mutation 'selectNode' with target node id
      this.eventBus.on('connection.add', 0, (event) => {
        let el = event.element.target
        store.commit('selectNode', el.businessObject)
      })
      // connection events: fire evaluateNodeData when connection logic changed
      this.eventBus.on(['connection.added','connection.remove','connection.changed'], 1000, (event) => {
        if(event.type === 'connection.added'){
          this.addFlag = true

        } else if(this.addFlag === true && event.type === 'connection.changed') {
          // addFlag is an ugly fix since targetRef will be undefined at first place
          // call evaluateNodeData when new connection created,
          evaluateNodeData(event.element.businessObject.targetRef, 'newConnectionToNode')
          this.addFlag = false
        }
        if(event.type === 'connection.remove') {
          this.removeTargetNode = event.element.businessObject.targetRef
        }
      })
      // commandStack event will fire when node attrs change and
      this.eventBus.on('commandStack.changed', 0 , event =>{
        if(event.businessObject){
          // let childNodes = getChildNodes(event.businessObject)
          evaluateNodeData(event.businessObject, 'nodeAttrsChanged')
        }
        if(this.removeTargetNode){
          // removeTargetNode is an ugly fix similar to addFlag
          // call evaluateNodeData when a connection removed
          evaluateNodeData(this.removeTargetNode, 'connectionRemoved')
          this.removeTargetNode = undefined
        }
      })
    }
    const unregisterEvents = () => {
      this.eventBus.off(['connection.add'])
    }
    // init vuex model for loaded graph through cli
    const initModel = () => {
      let nodes = this.cli.elements().flatMap(id => {
        let ele = this.cli.element(id).businessObject
        return ignoreList.indexOf(ele.$type) === -1 ? ele : []
      })
      function getProperty(node) {
        try {
          let attrs = getAttrs(node)
          if(attrs){
            return JSON.parse(attrs.PROPERTY)
          }
        } catch (error) {
          throw error
        }
      }
      for(let node of nodes) {
        store.commit('setTransfer', { id: node.id, obj: getProperty(node), init: true })
      }
      if(nodes.length > 0) {
        evaluateNodeData(this.cli.element(StartEventName).businessObject)
      }
    }
    // import done, register eventBus event
    this.eventBus.on('import.done', 0, () => {
      let attrs = getAttrs(this.cli.element(processName).businessObject)
      if(Object.keys(attrs).length !== 0){
        // canvas.zoom(attrs.scale)
        store.commit('setZoomLevel', attrs.scale)
        this.canvas.viewbox(attrs)
      }else {
        store.commit('setZoomLevel', 1)
      }
      initModel()
      registerEvents()
    })
    // disable eventBus if import mutiple times
    this.eventBus.on('import.render.start', 0, () => unregisterEvents)
  }
  importXML(xml){
    return new Promise(
      (resolve, reject) => {
        this.bpmnModeler.importXML(xml, err => {
        if (err) {
            reject(err)
        }
        resolve()
      })
    })
  }
  exportXML(){
    let rootNode = this.cli.element(processName).businessObject
    let viewbox = this.canvas.viewbox()
    rootNode.set('x', viewbox.x)
    rootNode.set('y', viewbox.y)
    rootNode.set('width', viewbox.width)
    rootNode.set('height', viewbox.height)
    rootNode.set('scale', viewbox.scale)
    return new Promise(
      (resolve, reject) => {
        this.bpmnModeler.saveXML({ format: true }, (err, xml) => {
          if (err) {
            reject(err)
          }
          resolve(xml)
        })
      }
    )
  }
  getNodeById(id) {
    try{
      return this.cli.element(id).businessObject
    }
    catch {
      return undefined
    }
  }
  createNode(node, x, y) {
    // console.log(canvas.viewbox(), canvas._cachedViewbox)
    let viewbox = this.canvas.viewbox()
    let scale = viewbox.scale
    let id = this.cli.create(
      node.data.type,
      {
        x: x / scale + viewbox.x,
        y: y / scale + viewbox.y,
      },
      processName
    )
    function getTextWidth(text, font) {
      // re-use canvas object for better performance
      var canvas =
        getTextWidth.canvas ||
        (getTextWidth.canvas = document.createElement('canvas'))
      var context = canvas.getContext('2d')
      context.font = font
      var metrics = context.measureText(text)
      return metrics.width
    }
    let el = this.cli.element(id)
    el.businessObject.name = node.data.label
    // el.businessObject = Object.assign(el.businessObject, node.data)
    // delete el.businessObject.label
    el.businessObject.set('ID', node.data.ID)
    // Beautify element
    // width & height should reflect on both VIEW & XML
    el.width = el.businessObject.di.bounds.width =
      getTextWidth(el.businessObject.name, '12px Arial, sans-serif') + 65
    el.height = el.businessObject.di.bounds.height = 36
    // select/focus element
    this.interactionEvents.triggerMouseEvent('click', Event, el)
    this.eventBus.fire('element.changed', {
      element: el,
    })
  }
  setDraggingNode(node) {
    this.draggingNode = node
  }
}

function diff(obj1, obj2) {
  return JSON.stringify(obj1) !== JSON.stringify(obj2)
}

function getChildNodes(businessObject) {
  try {
  return businessObject.outgoing.map((ele) => ele.targetRef)
  }
  catch {
    return []
  }
}
function getParentNodes(businessObject) {
  try {
    return businessObject.incoming.map((ele) => ele.sourceRef)
  }
  catch {
    return []
  }
}

// TODO: connect nodes on the graph
// eslint-disable-next-line
function setTargetNodes(businessObject, ...businessObjects) {

}

function getAttrs(businessObject) {
  try {
    return businessObject.$attrs
  } catch (error) {
    throw error
  }
}