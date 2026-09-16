import { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { calculateTotals, formatSar, type Product } from "@cooffeup/shared";

const products:Product[]=[
  {id:"espresso",sku:"CF-001",nameAr:"إسبريسو",nameEn:"Espresso",category:"coffee",price:1200,taxRateBps:1500,stock:100,active:true},
  {id:"latte",sku:"CF-002",nameAr:"لاتيه",nameEn:"Latte",category:"coffee",price:1800,taxRateBps:1500,stock:100,active:true},
  {id:"cold-brew",sku:"CF-003",nameAr:"كولد برو",nameEn:"Cold Brew",category:"cold",price:2000,taxRateBps:1500,stock:80,active:true},
  {id:"croissant",sku:"FD-001",nameAr:"كرواسون",nameEn:"Croissant",category:"bakery",price:1400,taxRateBps:1500,stock:40,active:true}
];
export default function Pos(){
  const [cart,setCart]=useState<Record<string,number>>({});
  const totals=useMemo(()=>calculateTotals(products.filter(p=>cart[p.id]).map(p=>({productId:p.id,name:p.nameAr,unitPrice:p.price,quantity:cart[p.id],taxRateBps:p.taxRateBps}))),[cart]);
  return <SafeAreaView style={s.safe}><View style={s.header}><Text style={s.brand}>CooffeUp</Text><Text style={s.status}>متصل وآمن ●</Text></View><ScrollView contentContainerStyle={s.body}>
    <Text style={s.eyebrow}>الوردية الصباحية</Text><Text style={s.title}>اختر المنتجات</Text><View style={s.grid}>{products.map(p=><Pressable key={p.id} style={s.card} onPress={()=>setCart(c=>({...c,[p.id]:(c[p.id]??0)+1}))}><Text style={s.icon}>☕</Text><Text style={s.product}>{p.nameAr}</Text><Text style={s.en}>{p.nameEn}</Text><Text style={s.price}>{formatSar(p.price)}</Text>{cart[p.id]?<Text style={s.badge}>{cart[p.id]}</Text>:null}</Pressable>)}</View>
    <View style={s.order}><Text style={s.orderTitle}>الطلب الحالي</Text>{products.filter(p=>cart[p.id]).map(p=><View style={s.line} key={p.id}><Text>{p.nameAr} × {cart[p.id]}</Text><Text>{formatSar(p.price*cart[p.id])}</Text></View>)}<View style={s.total}><Text style={s.totalText}>الإجمالي</Text><Text style={s.totalText}>{formatSar(totals.total)}</Text></View><Pressable disabled={!totals.total} style={[s.pay,!totals.total&&s.disabled]}><Text style={s.payText}>الدفع</Text></Pressable></View>
  </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:"#f4f1e9"},header:{height:64,backgroundColor:"#18392d",paddingHorizontal:20,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},brand:{color:"#fff",fontWeight:"800",fontSize:22},status:{color:"#b9ddc9",fontSize:12},body:{padding:18},eyebrow:{textAlign:"right",color:"#8a7250"},title:{textAlign:"right",fontWeight:"800",fontSize:27,marginBottom:18},grid:{flexDirection:"row",flexWrap:"wrap",gap:12},card:{backgroundColor:"white",borderRadius:17,padding:15,width:"48%",minHeight:170},icon:{fontSize:35},product:{textAlign:"right",fontWeight:"700",fontSize:17,marginTop:12},en:{textAlign:"right",color:"#888"},price:{textAlign:"right",color:"#7f5b28",fontWeight:"700",marginTop:8},badge:{position:"absolute",left:10,top:10,backgroundColor:"#18392d",color:"white",borderRadius:20,paddingHorizontal:9,paddingVertical:4},order:{marginTop:20,backgroundColor:"white",borderRadius:18,padding:18},orderTitle:{fontWeight:"800",fontSize:19,textAlign:"right",marginBottom:12},line:{flexDirection:"row-reverse",justifyContent:"space-between",paddingVertical:9,borderBottomWidth:1,borderBottomColor:"#eee"},total:{flexDirection:"row-reverse",justifyContent:"space-between",marginVertical:18},totalText:{fontWeight:"800",fontSize:19},pay:{backgroundColor:"#18392d",borderRadius:12,padding:14},disabled:{opacity:.4},payText:{color:"white",fontWeight:"700",textAlign:"center",fontSize:17}});
