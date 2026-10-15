<cfcomponent name="Worker">
<cffunction name="target"><cfreturn 1></cffunction>
<cffunction name="run"><cfreturn target()><cfquery name="cacheResult">SELECT * FROM users</cfquery></cffunction>
<cffunction name="fetch"><cfquery name="other">SELECT * FROM cacheResult</cfquery></cffunction>
</cfcomponent>
