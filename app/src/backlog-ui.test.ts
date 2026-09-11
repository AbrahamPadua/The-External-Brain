import {describe,expect,it} from 'vitest'
import {sortDocuments,sortTasks} from './App'
import type {DocumentRecord,InitiativeTask} from './model'

const doc=(p:Partial<DocumentRecord>):DocumentRecord=>({id:'x',initiativeId:'i',kind:'rm',title:'RM',authorId:'a',status:'submitted',body:'',version:1,versions:[],...p})

describe('backlog list ordering',()=>{
  it('puts live documents newest first and historical source periods newest first',()=>{
    const rows=[
      doc({id:'old-live',submittedAt:'2026-01-01T00:00:00Z'}),
      doc({id:'historical-1',historical:true,sourceOrder:1,submittedAt:'2026-09-11T00:00:00Z'}),
      doc({id:'new-live',submittedAt:'2026-08-01T00:00:00Z'}),
      doc({id:'historical-2',historical:true,sourceOrder:2,submittedAt:'2026-09-11T00:00:00Z'}),
    ]
    expect(sortDocuments(rows,'newest').map(d=>d.id)).toEqual(['new-live','old-live','historical-2','historical-1'])
  })

  it('sorts undated tasks after dated tasks',()=>{
    const tasks:InitiativeTask[]=[
      {id:'none',title:'None',description:'',status:'planned'},
      {id:'later',title:'Later',description:'',status:'planned',dueAt:'2026-10-02'},
      {id:'sooner',title:'Sooner',description:'',status:'planned',dueAt:'2026-09-12'},
    ]
    expect(sortTasks(tasks,'due').map(t=>t.id)).toEqual(['sooner','later','none'])
  })
})
