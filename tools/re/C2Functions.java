// Independently written helper; keep decompiled proprietary output outside Git.
// @category Carmageddon
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.Address;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public class C2Functions extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();Path out=Paths.get(args[0]);Files.createDirectories(out);
  DecompInterface d=new DecompInterface();d.openProgram(currentProgram);
  for(int i=1;i<args.length;i++) {
   Address address=toAddr(args[i]);Function f=getFunctionAt(address);
   if(f==null){disassemble(address);f=createFunction(address,"C2_"+args[i]);}
   if(f==null){println("NO FUNCTION "+args[i]+" containing="+getFunctionContaining(address));continue;}
   DecompileResults r=d.decompileFunction(f,90,monitor);
   if(r.decompileCompleted())Files.writeString(out.resolve(String.format("%08x.c",address.getOffset())),"/* "+f.getName()+" @ "+address+" */\n"+r.getDecompiledFunction().getC(),StandardCharsets.UTF_8);
   else println("FAILED "+args[i]+" "+r.getErrorMessage());
  }
  d.dispose();
 }
}
