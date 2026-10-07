// Independently written static-analysis helper. Decompiled output is local-only.
// @category Carmageddon
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

public class C2Export extends GhidraScript {
  public void run() throws Exception {
    String[] args=getScriptArgs();
    Path output=Paths.get(args[0]);Files.createDirectories(output);
    long lo=args.length>1?Long.decode(args[1]):0,hi=args.length>2?Long.decode(args[2]):Long.MAX_VALUE;
    DecompInterface decompiler=new DecompInterface();decompiler.openProgram(currentProgram);
    FunctionIterator funcs=currentProgram.getFunctionManager().getFunctions(true);
    int exported=0;
    while(funcs.hasNext()&&!monitor.isCancelled()) {
      Function function=funcs.next();long address=function.getEntryPoint().getOffset();
      if(address<lo||address>=hi)continue;
      DecompileResults result=decompiler.decompileFunction(function,60,monitor);
      if(result.decompileCompleted()) {
        String name=String.format("%08x",address);
        Files.writeString(output.resolve(name+".c"),"/* "+function.getName()+" @ "+name+" */\n"+result.getDecompiledFunction().getC(),StandardCharsets.UTF_8);
        exported++;
      } else println("FAILED "+function.getEntryPoint()+": "+result.getErrorMessage());
    }
    decompiler.dispose();println("Exported "+exported+" local functions into "+output);
  }
}
