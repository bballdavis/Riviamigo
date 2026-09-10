const state={userId:'fixture',accessToken:'fixture',logout:async()=>{}};
export const useAuth=Object.assign((select:any)=>select?select(state):state,{getState:()=>state,subscribe:()=>()=>{}});
export const useResolvedVehicleSelection=()=>({effectiveVehicleId:'fixture',vehicleSelectionReady:true,vehicles:[{id:'fixture',model:'R1S'}]});
export const useMe=()=>({data:{role:'user'}});
export const useCurrentVehicleStatus=()=>({data:{battery_level:78,range_miles:240}});
export const useVehicleStatus=()=>({status:null,connected:true,connectionState:'online'});
export const queryKeys={themePreferences:{forUser:(id:string)=>['theme',id]},unitPreferences:{current:['units']}};
let preferences:any={schemaVersion:2,mode:'dark',selection:{kind:'builtin',themeId:'rad'}};
export const themeClient={getPreferences:async()=>({preferences,etag:'fixture'}),updatePreferences:async(next:any)=>{preferences=next;return {preferences,etag:'fixture'};}};
